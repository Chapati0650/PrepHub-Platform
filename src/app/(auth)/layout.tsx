import { Logo } from "@/components/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-accent/30 p-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <Logo size="lg" />
        <div className="w-full [&>div]:shadow-lg">{children}</div>
      </div>
    </div>
  );
}
