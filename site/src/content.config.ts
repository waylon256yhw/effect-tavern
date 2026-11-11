import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { docsCollection, partialsCollection } from "@cloudflare/nimbus-docs/content";

const schemaFields = {
  audience: z.literal("human").optional(),
};

export const collections = {
  docs: defineCollection(docsCollection({ schemaFields })),
  zh: defineCollection(docsCollection({ base: "zh", schemaFields })),
  partials: defineCollection(partialsCollection()),
};
