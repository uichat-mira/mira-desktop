declare module "mime-types" {
  export function lookup(filenameOrExtension: string): string | false;
}
