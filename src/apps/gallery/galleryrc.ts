import { z } from 'zod';

// Configuration file that defines a gallery:
export const GalleryRc = z.object({
    // Displayed name (if not present, derived from directory name)
    name: z.string().optional(),
    // Longer description, none if not provided here.
    description: z.string().optional(),
    // Names of accounts which should see the gallery:
    accounts: z.array(z.string()),
    // TODO: Hide files by name.
});
