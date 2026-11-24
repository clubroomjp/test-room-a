import { total } from "room:a";
import { doubled } from "room:b";

export const result = `a=${total} b=${doubled}`;

export async function run() {
  const { runtime } = await import("room:d");
  return `d=${runtime}`;
}
