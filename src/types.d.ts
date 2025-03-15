/* Type declarations for modules without proper type definitions */

declare module 'recast' {
  export function parse(code: string, options?: any): any;
  export function print(ast: any): { code: string };
  // Add other necessary type declarations as needed
}

declare module 'esprima' {
  export interface Node {
    type: string;
    [key: string]: any;
  }
  
  export interface Program extends Node {
    body: Node[];
  }
  
  export function parseScript(code: string, options?: any): Program;
  export function parseModule(code: string, options?: any): Program;
}

declare module 'node-fetch' {
  interface Response {
    ok: boolean;
    statusText: string;
    json(): Promise<any>;
    text(): Promise<string>;
    buffer(): Promise<Buffer>;
    // Add other methods as needed
  }

  interface RequestInit {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    // Add other properties as needed
  }

  function fetch(url: string, init?: RequestInit): Promise<Response>;
  
  export default fetch;
}

/* Add any other modules that might need declarations */
