/**
 * issues イベントの JSON から、使う 3 項目（番号、題名、本文）だけを取り出す。
 * ほかの項目は読まない。本文は文字列としてだけ扱い、どこにも展開しない。
 */
import { isPositiveInteger, isRecord } from "./outcome.ts";

export interface IssueEvent {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

export const parseEvent = (text: string): IssueEvent | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  const issue = parsed["issue"];
  if (!isRecord(issue)) return undefined;
  const number = issue["number"];
  const title = issue["title"];
  const body = issue["body"];
  if (!isPositiveInteger(number) || typeof title !== "string") return undefined;
  if (body !== undefined && body !== null && typeof body !== "string") return undefined;
  return { number, title, body: typeof body === "string" ? body : "" };
};
