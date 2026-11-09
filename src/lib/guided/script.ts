import type { GuidedItemKind, GuidedPhase } from "@/generated/prisma/client";
import { TALK_FROM } from "./config";
import type { GuidedCommand } from "./control";
import type { SuggestedMove } from "./plan";

/**
 * Everything the teacher's console says to the teacher, in one place.
 *
 * The audience is an adult who may know nothing about the SAT (a substitute,
 * a counselor, a volunteer): every step says exactly what to do and what to
 * say, in plain words, with no test jargon. Wherever the script needs
 * something about the content (why the common wrong answer is wrong, why the
 * right answer is right), it hands over the question's own stored text to
 * read aloud, so the teacher never has to know the answer.
 *
 * `scriptFor` is pure: the phase and what the room has done in, one script
 * out. It is what the tests cover. Text in `lines` may contain LaTeX (`$...$`)
 * from the question bank and is rendered by the console.
 */

export type ScriptAction = { label: string; command: GuidedCommand };

/** Text from the question bank for the teacher to read to the class. */
export type ReadBlock = { heading: string; lines: string[] };

export type TeacherScript = {
  title: string;
  /** What to do, in order. */
  doThis: string[];
  /** What to say, word for word. */
  say: string[];
  readAloud: ReadBlock[];
  primary: ScriptAction | null;
  secondary: ScriptAction[];
};

export type ScriptInput = {
  phase: GuidedPhase;
  kind: GuidedItemKind | null;
  skill: string;
  suggestion: SuggestedMove | null;
  /** Share (0 to 1) right on the first vote, or null before anyone has answered. */
  firstRight: number | null;
  hasNextQuestion: boolean;
  /** Zero-based explanation step on the board. */
  step: number;
  /** The question's stored explanation steps, in order. */
  steps: string[];
  takeaway: string | null;
  /** "B", or the typed answer. */
  correctLabel: string | null;
  /** The text of the right choice, when it's multiple choice. */
  correctText: string | null;
  /** The wrong answer most students chose, and the stored reason it tempts people. */
  commonWrong: { label: string; note: string | null } | null;
  /** The recap's takeaways, from the questions' stored explanations. */
  takeaways: string[];
};

const NEXT: ScriptAction = { label: "Next step", command: { type: "STEP", delta: 1 } };
const BACK: ScriptAction = { label: "Back a step", command: { type: "STEP", delta: -1 } };
const MORE_TIME: ScriptAction = { label: "+30 seconds", command: { type: "ADD_TIME" } };

/** "about 7 out of 10 students", for a share between 0 and 1. */
export function outOfTen(share: number): string {
  const n = Math.round(share * 10);
  if (n <= 0) return "almost no students";
  if (n >= 10) return "almost all students"; // plural: "So far almost all students have it right"
  return `about ${n} out of 10 students`;
}

function answerLine(i: ScriptInput): string | null {
  if (!i.correctLabel) return null;
  return i.correctText ? `The correct answer is ${i.correctLabel}: ${i.correctText}` : `The correct answer is ${i.correctLabel}.`;
}

/** The question's own words on why the popular wrong answer is wrong. */
function wrongAnswerBlock(i: ScriptInput): ReadBlock | null {
  if (!i.commonWrong) return null;
  const { label, note } = i.commonWrong;
  return {
    heading: `Why ${label} is tempting but wrong (read this aloud)`,
    lines: [
      note
        ? `A lot of students picked ${label}. ${note}`
        : `A lot of students picked ${label}. It looks right at first glance, but it isn't. We'll see why when we go through the steps.`,
    ],
  };
}

function stepBlock(i: ScriptInput): ReadBlock | null {
  if (i.steps.length === 0) return null;
  const index = Math.min(Math.max(i.step, 0), i.steps.length - 1);
  return { heading: `Read step ${index + 1} of ${i.steps.length} aloud`, lines: [i.steps[index]] };
}

function allStepsBlock(i: ScriptInput): ReadBlock | null {
  return i.steps.length === 0 ? null : { heading: "Why the right answer is right (read this aloud)", lines: i.steps };
}

function compact(blocks: (ReadBlock | null)[]): ReadBlock[] {
  return blocks.filter((b): b is ReadBlock => b !== null);
}

export function scriptFor(i: ScriptInput): TeacherScript {
  const low = i.firstRight !== null && i.firstRight < TALK_FROM;
  const afterLast: ScriptAction = {
    label: i.hasNextQuestion ? "Next question" : "Start their own questions",
    command: { type: "NEXT" },
  };
  const empty: TeacherScript = { title: "", doThis: [], say: [], readAloud: [], primary: null, secondary: [] };

  switch (i.phase) {
    case "LOBBY":
      return {
        ...empty,
        title: "Get everyone in the room",
        doThis: [
          "Tell students to open their laptops, go to prephubtp.com/live and type the code shown on this screen. Students in your class can also press Join on their PrepHub home page.",
          "Students who are in will see a practice question. Wait until most of the class shows as here under \"The room\".",
          "Pressing \"Start the session\" shows the practice question's answer on every screen, so wait until most students have answered it.",
        ],
        say: ["Welcome, everyone. Please open your laptop, go to prephubtp.com/live and type the code on the board. When you're in, start on the question on your screen."],
        primary: { label: "Start the session", command: { type: "NEXT" } },
      };
    case "PLAN":
      return {
        ...empty,
        title: "Tell students what today looks like",
        doThis: ["Read the line below out loud. It takes about ten seconds."],
        say: [
          `Today we're practicing ${i.skill}. First we'll look at an example together. Then we'll do a few questions as a class, and then you'll practice on your own.`,
        ],
        primary: { label: "Show the worked example", command: { type: "NEXT" } },
      };
    case "EXAMPLE":
      return {
        ...empty,
        title: "Walk through the example",
        doThis:
          i.steps.length > 0
            ? [
                "Press \"Next step\" to show one step on the board. Read the step below out loud, then pause for a moment before the next one.",
                "The arrow keys on your keyboard (or a presentation clicker) do the same thing. Students' screens stay one step behind yours so they can catch up.",
              ]
            : ["This example has no written steps. Read the question out loud and ask the class how they would start, then continue."],
        say: i.step === 0 ? ["Let's look at one example together first. Just follow along. You don't need to answer anything yet."] : [],
        readAloud: compact([stepBlock(i)]),
        // The big button walks the steps and only becomes "Start question 1" on the last one: a teacher
        // who doesn't know the SAT presses the big button, and it used to skip the walkthrough the
        // script asks for (review, 2026-11-09). Skipping stays possible, as a small button.
        ...(i.steps.length === 0 || i.step >= i.steps.length - 1
          ? { primary: { label: "Start question 1", command: { type: "NEXT" } }, secondary: i.steps.length > 0 ? [BACK] : [] }
          : { primary: NEXT, secondary: [BACK, { label: "Skip to question 1", command: { type: "NEXT" } }] }),
      };
    case "THINK": {
      const s = i.suggestion;
      const share = i.firstRight === null ? "" : outOfTen(i.firstRight);
      const base: TeacherScript = {
        ...empty,
        secondary: [MORE_TIME, { label: "Skip this question", command: { type: "SKIP" } }],
      };
      if (s === "TALK") {
        return {
          ...base,
          title: "The class is split: have students talk it over",
          doThis: [
            `So far ${share} have it right. When the class is split like this, students learn the most from explaining their thinking to each other.`,
            "Press \"Start partner talk\". Don't tell students the answer yet.",
          ],
          say: ["Turn to the person next to you. Tell them which answer you picked and why. Try to change each other's mind with a reason, not just a letter."],
          primary: { label: "Start partner talk", command: { type: "TALK" } },
          secondary: [{ label: "Show the answer", command: { type: "REVEAL" } }, ...base.secondary],
        };
      }
      if (s === "MOVE_ON") {
        return {
          ...base,
          title: "Most students have it: show the answer",
          doThis: [`So far ${share} have it right, so there's no need to spend long on this one.`, "Press \"Show the answer\"."],
          say: ["Most of you got this one. Let's see the answer."],
          primary: { label: "Show the answer", command: { type: "REVEAL" } },
          secondary: [{ label: "Partner talk", command: { type: "TALK" } }, ...base.secondary],
        };
      }
      if (s === "EXPLAIN") {
        return {
          ...base,
          title: "Most students missed it: show the answer, then go through it",
          doThis: [
            `So far ${share.startsWith("almost") ? share : `only ${share}`} have it right. That is too few for students to help each other, so you will go through it together.`,
            "Press \"Show the answer\", then \"Explain it\". This screen will give you the words to read.",
          ],
          say: ["This was a tough one, and that's fine. Let's look at the answer and work through it together."],
          primary: { label: "Show the answer", command: { type: "REVEAL" } },
          secondary: [{ label: "Partner talk", command: { type: "TALK" } }, ...base.secondary],
        };
      }
      return {
        ...base,
        title: "Students are answering on their own",
        doThis: [
          "Wait while students answer. The count of students who have answered is on the left. The clock is only a guide.",
          "When about three out of four students have answered, or the clock reaches zero, press the button below. Whatever a student has picked by then counts as their answer.",
        ],
        say: ["Work on this one by yourself. No talking yet. Pick your answer and press Submit."],
        primary: { label: "Show the answer", command: { type: "REVEAL" } },
        secondary: [{ label: "Partner talk", command: { type: "TALK" } }, ...base.secondary],
      };
    }
    case "TALK":
      return {
        ...empty,
        title: "Students are talking in pairs",
        doThis: [
          "Walk around the room and listen. Don't give away the answer.",
          "When the talking slows down, or the clock reaches zero, press \"Vote again\".",
        ],
        say: ["Talk with your neighbor now. Say which answer you picked and why. If their reason is better than yours, you're allowed to change your mind."],
        primary: { label: "Vote again", command: { type: "REVOTE" } },
        secondary: [MORE_TIME],
      };
    case "REVOTE":
      return {
        ...empty,
        title: "Second vote",
        doThis: [
          "Wait until most students have voted again.",
          "Then press \"Show the answer\". The board will show the first vote and the second vote side by side.",
        ],
        say: ["Vote again now. You can keep your answer or change it."],
        primary: { label: "Show the answer", command: { type: "REVEAL" } },
        secondary: [MORE_TIME],
      };
    case "REVEAL": {
      const answer = answerLine(i);
      const answerBlock: ReadBlock | null = answer ? { heading: "Read the answer aloud", lines: [answer] } : null;
      if (i.kind === "WARMUP") {
        return {
          ...empty,
          title: "The warm-up answer is on the board",
          doThis: ["Read the answer below to the class.", "Then press \"Show today's plan\"."],
          say: ["Check your answer against the board. Don't worry if you missed it. That's what the warm-up is for."],
          readAloud: compact([answerBlock, wrongAnswerBlock(i)]),
          primary: { label: "Show today's plan", command: { type: "NEXT" } },
        };
      }
      if (low) {
        return {
          ...empty,
          title: "Most students missed this one",
          doThis: [
            "Read the answer below to the class.",
            "Press \"Explain it\" and go through the steps together. Then press \"Try one like it\" so students can try a similar question alone.",
          ],
          say: ["A lot of us got this one wrong, and that's okay. Let's go through it step by step."],
          readAloud: compact([answerBlock, wrongAnswerBlock(i)]),
          primary: { label: "Explain it", command: { type: "EXPLAIN" } },
          secondary: [{ label: "One like it", command: { type: "TWIN" } }, afterLast],
        };
      }
      return {
        ...empty,
        title: "The answer is on the board",
        doThis: [
          "Read the answer below to the class, and the reason students pick the wrong answer.",
          i.hasNextQuestion ? "Then press \"Next question\"." : "Then press \"Start their own questions\".",
        ],
        say: ["Check your answer against the board. If you got it wrong, look at why before we move on."],
        readAloud: compact([answerBlock, wrongAnswerBlock(i), allStepsBlock(i)]),
        primary: afterLast,
        secondary: [
          { label: "Explain it", command: { type: "EXPLAIN" } },
          { label: "One like it", command: { type: "TWIN" } },
        ],
      };
    }
    case "EXPLAIN": {
      const last = i.steps.length > 0 && i.step >= i.steps.length - 1;
      const first = i.step === 0;
      return {
        ...empty,
        title: "Go through it one step at a time",
        doThis: [
          "Press \"Next step\" to show a step. Read it out loud, then ask \"Does that make sense?\" before the next step.",
          "The arrow keys (or a clicker) do the same thing. Students who picked the popular wrong answer also see on their own screen why it's wrong.",
        ],
        say: [
          ...(first ? ["Let's work through this one slowly, one step at a time."] : []),
          ...(last ? ["Does anyone have a question before we move on?"] : []),
        ],
        readAloud: compact([
          first ? wrongAnswerBlock(i) : null,
          stepBlock(i),
          last && i.takeaway ? { heading: "Finish with this rule (read it aloud)", lines: [i.takeaway] } : null,
        ]),
        // As in the example: "Next step" until the last step, then what comes after.
        ...(() => {
          const after = low ? { label: "Try one like it", command: { type: "TWIN" } as const } : afterLast;
          const other = low ? afterLast : { label: "One like it", command: { type: "TWIN" } as const };
          return last || i.steps.length === 0
            ? { primary: after, secondary: [BACK, other] }
            : { primary: NEXT, secondary: [BACK, after, other] };
        })(),
      };
    }
    case "OWN":
      return {
        ...empty,
        title: "Students are working on their own",
        doThis: [
          "Walk around the room. If a student is stuck on how to use the screen, help with that. You don't need to explain the questions: after a student answers, their screen explains the answer.",
          "\"The room\" shows how many each student has finished. When most are done, or the clock reaches zero, press \"Show the recap\".",
        ],
        say: [
          "Now you'll work on your own. These questions were picked for you. After you answer one, read the explanation on your screen, especially if you got it wrong.",
        ],
        primary: { label: "Show the recap", command: { type: "RECAP" } },
        secondary: [MORE_TIME],
      };
    case "RECAP":
      return {
        ...empty,
        title: "Wrap up",
        doThis: [
          i.takeaways.length > 0
            ? "Read the takeaways below out loud and tell the class when the next session is."
            : "Tell the class what you practiced today and when the next session is.",
          "Press \"End the session\". You will then see how each student did.",
        ],
        say: ["That's the session. Look at your results on your screen, and tap how the pace felt for you."],
        readAloud:
          i.takeaways.length > 0 ? [{ heading: "Read these takeaways aloud", lines: i.takeaways }] : [],
        primary: { label: "End the session", command: { type: "END" } },
      };
  }
}

// ---------------------------------------------------------------------------
// Individual practice: the teacher's monitor.
// ---------------------------------------------------------------------------

export type MonitorGuidanceInput = {
  joined: number;
  rosterSize: number;
  idle: number;
  needsHelp: number;
  done: number;
};

export type MonitorGuidance = { title: string; doThis: string[]; say: string[] };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What to do right now in an individual practice session, in plain words. */
export function monitorGuidance(i: MonitorGuidanceInput): MonitorGuidance {
  if (i.joined === 0) {
    return {
      title: "Waiting for students to join",
      doThis: [
        "Tell students to open their laptops, go to prephubtp.com/live and type the code shown on this screen. Students in your class can also press Join on their PrepHub home page.",
        "Each student gets their own questions and works at their own speed. You don't have to run anything.",
      ],
      say: ["Please open your laptop, go to prephubtp.com/live and type the code on the board. You'll each get your own questions. Work at your own speed."],
    };
  }
  if (i.needsHelp > 0) {
    return {
      title: `${plural(i.needsHelp, "student may", "students may")} need help`,
      doThis: [
        "Walk over to the students marked \"Needs help\" and look at their screen. They have missed several questions in a row.",
        "You don't need to know the answer. Every question explains itself after it's answered. Ask the student to read that explanation out loud to you.",
      ],
      say: ["Can you read me the explanation under your last answer? What does it say to do first? Now try the next one with that in mind."],
    };
  }
  if (i.idle > 0) {
    return {
      title: `${plural(i.idle, "student has", "students have")} gone quiet`,
      doThis: [
        "Check in quietly with the students marked \"Idle\". They are here but haven't answered anything for a few minutes.",
        "They may be stuck on a question or distracted. Ask them to read the question out loud, then pick the answer that seems best.",
      ],
      say: ["How's it going? Read me the question you're on. What's your best guess? Pick one and see what the explanation says."],
    };
  }
  if (i.done >= i.joined) {
    return {
      title: "Everyone has finished",
      doThis: ["Press \"End session\" to close it. You will then see how each student did."],
      say: ["Great work, everyone. Look at your results on your screen."],
    };
  }
  return {
    title: "Students are practicing",
    doThis: [
      "Nothing to do but watch. Each student's screen shows the right answer and an explanation as soon as they answer, so you don't need to teach the content.",
      "This screen updates by itself. It will point out anyone who needs help.",
    ],
    say: ["Keep going at your own speed. If you get one wrong, read the explanation before you move on."],
  };
}
