import { z } from 'zod';

export const ImportFinished = z.object({
    import_id: z.string(),
    tree_id: z.number(),
    entryCount: z.number(),
    newCount: z.number(),
    changedCount: z.number(),
    deletedCount: z.number()
});
