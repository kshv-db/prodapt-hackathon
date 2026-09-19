import type { AiClient, CompleteRequest } from "@/lib/ai/client";

export type Responder = (req: CompleteRequest, call: number) => string | Promise<string>;

/** Scriptable fake OpenAI client. Records every request so tests can assert on prompts. */
export class FakeAi implements AiClient {
  calls: CompleteRequest[] = [];
  streams: Omit<CompleteRequest, "json">[] = [];
  constructor(
    private readonly responder: Responder = () => "",
    private readonly streamChunks: string[] = ["Hello", " there."],
  ) {}

  async complete(req: CompleteRequest): Promise<string> {
    this.calls.push(req);
    return this.responder(req, this.calls.length);
  }

  async *stream(req: Omit<CompleteRequest, "json">): AsyncIterable<string> {
    this.streams.push(req);
    for (const c of this.streamChunks) yield c;
  }
}
