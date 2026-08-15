import assert from "node:assert/strict";
import { collectImage, readImageEvent } from "../lib/image-tool.js";

const done = collectImage({ type: "response.output_item.done", item: { type: "image_generation_call", result: "aGVsbG8=", revised_prompt: "a cat", output_format: "png" } });
assert.deepEqual(done, { data: "aGVsbG8=", format: "png", revisedPrompt: "a cat" });
const completed = collectImage({ type: "response.completed", response: { output: [{ type: "image_generation_call", result: "d29ybGQ=", output_format: "webp" }] } });
assert.deepEqual(completed, { data: "d29ybGQ=", format: "webp", revisedPrompt: undefined });
const response = new Response('data: {"type":"response.output_item.done","item":{"type":"image_generation_call","result":"eA==","output_format":"png"}}\n\ndata: [DONE]\n\n');
assert.equal((await readImageEvent(response)).data, "eA==");
console.log("image protocol checks passed");
