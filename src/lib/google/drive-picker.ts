/// <reference types="google.picker" />

// Client-side Google Drive file picking for the bulk-upload page — loads
// Google Identity Services (for a Drive-scoped access token) and the legacy
// Picker API (for the actual file-browsing UI) on demand, entirely in the
// browser. Deliberately a separate, Owner-triggered consent flow from the
// app's own "Sign in with Google" (src/auth.ts) — that OAuth client only
// requests basic profile/email and is used by every student/admin/owner who
// signs in, so widening its scope to Drive access would prompt every signed-
// -in user for Drive permissions instead of just the Owner clicking
// "Connect Google Drive" on this one page. The OAuth *client id* itself is
// safely reused (client ids are public identifiers, not secrets — see
// AUTH_GOOGLE_ID passed down as a prop from the server component); only a
// new Picker API key (public, domain-restricted, like the Desmos key) is a
// genuinely new credential.
//
// Picker types come from the official @types/google.picker devDependency —
// note its ResponseObject/DocumentObject fields are accessed via enum-keyed
// properties (e.g. data[google.picker.Response.ACTION]), not plain named
// properties like data.action, which is why this file leans on those enum
// constants throughout rather than the more natural-looking dot access.

const GIS_SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const GAPI_SCRIPT_SRC = "https://apis.google.com/js/api.js";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly";
const SUPPORTED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"];

type TokenResponse = { access_token?: string; error?: string };

// Google Identity Services (GIS) has no widely-adopted official @types
// package the way the Picker API does, so this piece is hand-declared — a
// small, stable surface (just requesting an access token for a scope).
// Namespace syntax (not an interface/const) is required here, not just
// stylistic: it's how this merges with @types/google.picker's own ambient
// `declare namespace google { namespace picker {...} }` rather than
// conflicting with it.
/* eslint-disable @typescript-eslint/no-namespace */
declare global {
  namespace google {
    namespace accounts {
      namespace oauth2 {
        function initTokenClient(config: {
          client_id: string;
          scope: string;
          callback: (response: TokenResponse) => void;
        }): { requestAccessToken: () => void };
      }
    }
  }
  interface Window {
    gapi?: { load: (api: string, config: { callback: () => void; onerror?: () => void }) => void };
  }
}
/* eslint-enable @typescript-eslint/no-namespace */

let scriptsLoadPromise: Promise<void> | null = null;
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function loadGoogleScripts(): Promise<void> {
  if (!scriptsLoadPromise) {
    scriptsLoadPromise = Promise.all([loadScript(GIS_SCRIPT_SRC), loadScript(GAPI_SCRIPT_SRC)])
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            window.gapi!.load("picker", { callback: resolve, onerror: () => reject(new Error("Failed to load Google Picker")) });
          }),
      )
      .catch((err) => {
        scriptsLoadPromise = null;
        throw err;
      });
  }
  return scriptsLoadPromise;
}

function requestAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) {
          reject(new Error(response.error ?? "Google didn't grant Drive access."));
          return;
        }
        resolve(response.access_token);
      },
    });
    tokenClient.requestAccessToken();
  });
}

// A DocsView (not the flat ViewId.DOCS_IMAGES "Images" search view) so the
// Owner gets the normal My Drive folder browser — setIncludeFolders lets
// folders show up for navigation, setSelectFolderEnabled(false) keeps
// clicking one a "navigate in" action rather than a "select this" action,
// and setMimeTypes restricts which *files* are selectable within any folder
// to the three image types the content pipeline accepts. MULTISELECT_ENABLED
// is needed explicitly below — the picker only allows one file at a time by
// default otherwise.
function openPicker(accessToken: string, apiKey: string): Promise<google.picker.DocumentObject[]> {
  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(false)
      .setMimeTypes(SUPPORTED_MIME_TYPES.join(","));

    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(accessToken)
      .setDeveloperKey(apiKey)
      .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
      .setCallback((data) => {
        const action = data[google.picker.Response.ACTION];
        if (action === google.picker.Action.PICKED) {
          resolve(data[google.picker.Response.DOCUMENTS] ?? []);
        } else if (action === google.picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

async function downloadDriveFile(doc: google.picker.DocumentObject, accessToken: string): Promise<File> {
  const id = doc[google.picker.Document.ID]!;
  const name = doc[google.picker.Document.NAME] ?? id;
  const mimeType = doc[google.picker.Document.MIME_TYPE]!;
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Couldn't download "${name}" from Drive.`);
  const blob = await response.blob();
  return new File([blob], name, { type: mimeType });
}

export type DrivePickResult = { images: File[]; skipped: string[] };

// Opens the Drive picker and returns the picked images as File objects —
// same shape the zip/multi-select paths already produce, so the caller can
// feed the result into the exact same Row list either way. Resolves to an
// empty result (no images, no skipped) if the Owner cancels the picker or
// the consent popup, rather than throwing — cancellation isn't an error.
export async function pickImagesFromDrive(clientId: string, apiKey: string): Promise<DrivePickResult> {
  await loadGoogleScripts();
  const accessToken = await requestAccessToken(clientId);
  const docs = await openPicker(accessToken, apiKey);

  const images: File[] = [];
  const skipped: string[] = [];
  for (const doc of docs) {
    const mimeType = doc[google.picker.Document.MIME_TYPE];
    if (!mimeType || !SUPPORTED_MIME_TYPES.includes(mimeType)) {
      skipped.push(doc[google.picker.Document.NAME] ?? doc[google.picker.Document.ID] ?? "unknown file");
      continue;
    }
    images.push(await downloadDriveFile(doc, accessToken));
  }
  return { images, skipped };
}
