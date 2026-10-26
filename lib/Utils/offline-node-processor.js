/**
 * Creates a processor for offline stanza nodes that:
 * - Queues nodes for sequential processing
 * - Yields to the event loop periodically to avoid blocking
 * - Catches handler errors to prevent the processing loop from crashing
 */
export function makeOfflineNodeProcessor(nodeProcessorMap, deps, batchSize = 10) {
    const nodes = [];
    let isProcessing = false;

    const tick = () => {
        if (isProcessing) {
            return;
        }
        if (!nodes.length || !deps.isWsOpen()) {
            return;
        }
        isProcessing = true;
        const promise = async () => {
            let processedInBatch = 0;
            while (nodes.length && deps.isWsOpen()) {
                const { type, node } = nodes.shift();
                const nodeProcessor = nodeProcessorMap.get(type);
                if (!nodeProcessor) {
                    deps.onUnexpectedError(new Error(`unknown offline node type: ${type}`), 'processing offline node');
                    continue;
                }
                try {
                    await nodeProcessor(node);
                }
                catch (err) {
                    deps.onUnexpectedError(err, `processing offline ${type}`);
                }
                processedInBatch++;
                if (processedInBatch >= batchSize) {
                    processedInBatch = 0;
                    await deps.yieldToEventLoop();
                }
            }
            isProcessing = false;
            // more nodes may have been enqueued while ws was closed mid-loop, or
            // the loop exited on !isWsOpen() with nodes still pending — recheck.
            if (nodes.length && deps.isWsOpen()) {
                tick();
            }
        };
        promise().catch(error => {
            isProcessing = false;
            deps.onUnexpectedError(error, 'processing offline nodes');
            // don't leave queued nodes stranded after an unexpected failure
            if (nodes.length && deps.isWsOpen()) {
                tick();
            }
        });
    };

    const enqueue = (type, node) => {
        nodes.push({ type, node });
        tick();
    };

    /** Call after reconnect to drain anything left queued from before the ws closed. */
    const resume = () => tick();

    return { enqueue, resume };
}
//# sourceMappingURL=offline-node-processor.js.map
