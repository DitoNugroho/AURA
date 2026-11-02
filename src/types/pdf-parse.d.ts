declare module "pdf-parse" {
  import type { Buffer } from "node:buffer";

  function parse(data: Buffer): Promise<{ text: string }>;

  export default parse;
}
