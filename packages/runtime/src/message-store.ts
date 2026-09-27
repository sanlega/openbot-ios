import { newId, type Message } from "@openbot/contracts";

/** Plan §4.1 `Message`. WS1 backs this with `@openbot/store`'s `messages` table; this in-memory adapter is enough for WS2's own tests. */
export interface MessageStore {
  create(input: Omit<Message, "id" | "createdAt">): Message;
  list(threadId: string): Message[];
}

export class InMemoryMessageStore implements MessageStore {
  private readonly messages: Message[] = [];

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  create(input: Omit<Message, "id" | "createdAt">): Message {
    const message: Message = { ...input, id: newId("message"), createdAt: this.now() };
    this.messages.push(message);
    return message;
  }

  list(threadId: string): Message[] {
    return this.messages.filter((m) => m.threadId === threadId);
  }

  all(): Message[] {
    return [...this.messages];
  }
}
