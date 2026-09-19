/** Public API of the AI layer. Backend routes import from "@/lib/ai" only. */
export { runAgent, toolDefinitions, TOOL_SCHEMAS } from "./agent";
export type { RunAgentArgs, LlmFn, LlmMessage, LlmReply, ToolName } from "./agent";
export {
  parseExpense,
  categorizeBatch,
  proposeBudget,
  writeInsight,
  writeFutureNarrative,
  writeNudge,
  explainWhatIf,
  streamChat,
  parsedExpenseSchema,
} from "./tasks";
export type { ParsedExpense, CategorizedRow, ChatTurn } from "./tasks";
export { PERSONAS, resolvePersona } from "./personas";
export type { Persona } from "./personas";
export { findUngroundedNumbers } from "./grounding";
export {
  checkOutput,
  createRateLimiter,
  gateUserMessage,
  redactSensitive,
  sanitizeUserText,
} from "./guardrails";
export { checkExpenseDate, checkNarrative, wordCount } from "./validate";
export { aiMock } from "./config";
export type {
  AgentEvent,
  AddExpenseArgs,
  FactSheet,
  Language,
  NudgeTrigger,
  ProjectionFacts,
  ProposableTool,
  ToolExecutors,
} from "./types";
