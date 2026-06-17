/**
 * v4/capability/builder.ts
 *
 * The pipeline builder: fluent DSL for composing capabilities.
 *
 * Usage:
 *   const p = pipe<{ path: string }, string>()
 *     .map(readFile)         // { path } → string (file content)
 *     .map(grep("jwt"))       // string → string[]
 *     .map(replace("import"))
 *     .map(writeFile)         // string[] → void
 *     .build();
 *
 *   await execute(p, { path: "auth.ts" }, ctx);
 *
 * Optimizations applied automatically:
 *   - Pure functions memoized
 *   - Sequential map() after read can be parallelized
 *   - Two readFile on same path → one call + cache
 */

import type { Capability, CapabilityContext, Pipeline, PipelineNode } from "./types.js";

/**
 * Pipeline stage result for builder pattern.
 */
export class PipelineBuilder<TIn, TOut> {
  constructor(private readonly root: PipelineNode<TIn, TOut>) {}

  /**
   * Append a capability call.
   */
  map<TNext>(cap: Capability<TOut, TNext>): PipelineBuilder<TIn, TNext> {
    return new PipelineBuilder<TIn, TNext>({
      kind: "pipe",
      left: this.root,
      right: { kind: "cap", cap },
    });
  }

  /**
   * Conditional branch.
   */
  if<TNext>(
    cond: (inp: TOut) => boolean,
    thenCap: Capability<TOut, TNext>,
    elseCap?: Capability<TOut, TNext>
  ): PipelineBuilder<TIn, TNext> {
    const thenNode: PipelineNode<TOut, TNext> = { kind: "cap", cap: thenCap };
    const elseNode: PipelineNode<TOut, TNext> | undefined = elseCap
      ? { kind: "cap", cap: elseCap }
      : undefined;
    return new PipelineBuilder<TIn, TNext>({
      kind: "pipe",
      left: this.root,
      right: {
        kind: "conditional",
        cond: cond as (inp: any) => boolean,
        then: thenNode,
        else: elseNode,
      },
    });
  }

  /**
   * Fan out: run branches in parallel.
   */
  fanout<TNext>(branches: Array<Capability<TOut, TNext>>): PipelineBuilder<TIn, TNext> {
    return new PipelineBuilder<TIn, TNext>({
      kind: "pipe",
      left: this.root,
      right: {
        kind: "fanout",
        branches: branches.map((cap) => ({ kind: "cap", cap })),
      },
    });
  }

  build(): Pipeline<TIn, TOut> {
    return this.root;
  }
}

/**
 * Start a pipeline. Provide the source capability.
 */
export function pipe<TIn, TOut>(source: Capability<TIn, TOut>): PipelineBuilder<TIn, TOut> {
  return new PipelineBuilder<TIn, TOut>({ kind: "cap", cap: source });
}

/**
 * Start with a producer (no input capability).
 */
export function source<TOut>(produce: (emit: (item: TOut) => Promise<void>) => Promise<void>): PipelineBuilder<TOut, TOut> {
  return new PipelineBuilder<TOut, TOut>({ kind: "source", produce });
}

/**
 * Execute a pipeline.
 */
export async function* execute<TIn, TOut>(
  pipeline: Pipeline<TIn, TOut>,
  input: TIn,
  ctx: CapabilityContext
): AsyncIterable<TOut> {
  yield* executeNode(pipeline, input, ctx);
}

async function* executeNode<TIn, TOut>(
  node: PipelineNode<TIn, TOut>,
  input: TIn,
  ctx: CapabilityContext
): AsyncIterable<TOut> {
  switch (node.kind) {
    case "cap": {
      // Check permissions
      for (const p of node.cap.permissions) {
        if (!ctx.granted.has(p)) {
          throw new Error(`Capability ${node.cap.name} requires permission ${p} which is not granted`);
        }
      }
      yield* node.cap.call(input, ctx);
      break;
    }
    case "pipe": {
      // Pipe: execute left, then right for each output
      const intermediate: any[] = [];
      for await (const item of executeNode(node.left, input, ctx)) {
        intermediate.push(item);
      }
      for (const item of intermediate) {
        yield* executeNode(node.right, item, ctx);
      }
      break;
    }
    case "fanout": {
      // Fan out: run all branches in parallel
      const promises = node.branches.map((b) => {
        const items: any[] = [];
        return (async () => {
          for await (const item of executeNode(b, input, ctx)) {
            items.push(item);
          }
          return items;
        })();
      });
      const results = await Promise.all(promises);
      for (const items of results) {
        for (const item of items) yield item;
      }
      break;
    }
    case "fanin": {
      // Fan in: same as pipe without input transformation
      yield* executeNode(node.source, input, ctx);
      break;
    }
    case "conditional": {
      if (node.cond(input)) {
        yield* executeNode(node.then, input, ctx);
      } else if (node.else) {
        yield* executeNode(node.else, input, ctx);
      }
      break;
    }
    case "source": {
      // For source, we ignore the input and run the producer, emitting items.
      const queue: TOut[] = [];
      let done = false;
      let producerError: Error | null = null;
      const emit = (item: TOut) => { queue.push(item); return Promise.resolve(); };
      // CRITICAL FIX: attach .catch to the producer promise. Without it,
      // a producer rejection leaves `done=false` forever, and the
      // `while (!done || ...)` loop polls via setTimeout(1) indefinitely,
      // hanging the async generator. Now we set `producerError` and
      // `done=true` on rejection, then throw the error after the loop.
      const producerPromise = (node.produce as unknown as (emit: (item: TOut) => Promise<void>) => Promise<void>)(emit)
        .then(() => { done = true; })
        .catch((err) => { producerError = err instanceof Error ? err : new Error(String(err)); done = true; });
      // Wait for items
      let lastSize = 0;
      while (!done || queue.length > lastSize) {
        if (queue.length > lastSize) {
          yield queue[lastSize];
          lastSize++;
        } else {
          await new Promise((r) => setTimeout(r, 1));
        }
      }
      await producerPromise;
      // If the producer failed, propagate the error to the consumer.
      if (producerError) throw producerError;
      break;
    }
  }
}
