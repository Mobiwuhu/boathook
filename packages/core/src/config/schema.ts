import { z } from "incur";
import { parseRetentionDuration } from "../artifacts.ts";
import { MAX_TIMEOUT_MS } from "../timeout.ts";

export const TRUST_PROJECT_CONFIG_ENV = "BOATHOOK_TRUST_PROJECT_CONFIG";

const urlContains = z.strictObject({ urlContains: z.string() });
const urlPattern = z.strictObject({ urlPattern: z.string() });
const elementVisible = z.strictObject({ elementVisible: z.string() });
const textVisible = z.strictObject({ textVisible: z.string() });

const environmentSchema = z.strictObject({
	loginUrl: z.string().url(),
	userEnvVar: z.string().min(1),
	passEnvVar: z.string().min(1),
	usernameField: z.string().optional(),
	passwordField: z.string().optional(),
	submitButton: z.string().optional(),
	successCondition: z.union([urlContains, urlPattern, elementVisible]),
});
export type EnvironmentConfig = z.infer<typeof environmentSchema>;

const assertConditionSchema = z.union([
	z.strictObject({ visible: z.string() }),
	z.strictObject({ notVisible: z.string() }),
	z.strictObject({ textContains: z.string() }),
	z.strictObject({ textNotContains: z.string() }),
	urlContains,
	urlPattern,
	z.strictObject({
		elementText: z.strictObject({ selector: z.string(), contains: z.string() }),
	}),
	z.strictObject({
		elementCount: z.strictObject({
			selector: z.string(),
			count: z.number().int().nonnegative(),
		}),
	}),
]);
export type AssertCondition = z.infer<typeof assertConditionSchema>;

const permissionSchema = z.strictObject({
	page: z.string(),
	granted: assertConditionSchema,
	denied: assertConditionSchema,
});

const healthcheckPageSchema = z.strictObject({
	url: z.string(),
	name: z.string().optional(),
	screenshot: z.boolean().optional(),
	console: z.enum(["error", "warning"]).optional(),
	assertions: z.array(assertConditionSchema).optional(),
});
export type HealthcheckPage = z.infer<typeof healthcheckPageSchema>;

const retentionDuration = z
	.string()
	.refine(
		(value) => parseRetentionDuration(value) !== null,
		"Use a duration like 7d, 24h, or 30m.",
	)
	.optional();

const artifactsSchema = z.strictObject({
	retention: z
		.strictObject({
			default: retentionDuration,
			screenshots: retentionDuration,
			traces: retentionDuration,
			videos: retentionDuration,
		})
		.optional(),
});

const waitConditionSchema = z.union([
	urlContains,
	urlPattern,
	elementVisible,
	textVisible,
	z.strictObject({ timeout: z.number().nonnegative() }),
]);
export type WaitCondition = z.infer<typeof waitConditionSchema>;

const flowConditionSchema = z.union([
	urlContains,
	urlPattern,
	elementVisible,
	z.strictObject({ elementNotVisible: z.string() }),
	textVisible,
]);
export type FlowCondition = z.infer<typeof flowConditionSchema>;

const indexSchema = z.number().int().nonnegative();
const clickTargetSchema = z.union([
	z.string(),
	z
		.strictObject({
			name: z.string(),
			index: indexSchema.optional(),
			near: z.string().optional(),
		})
		.refine(
			({ index, near }) => index === undefined || near === undefined,
			"Choose index or near.",
		),
	z.strictObject({ selector: z.string() }),
]);
export type ClickTarget = z.infer<typeof clickTargetSchema>;

const fieldTargetSchema = z.union([
	z.strictObject({ selector: z.string(), value: z.string() }),
	z.record(
		z.string().refine((key) => key !== "selector"),
		z.union([
			z.string(),
			z.strictObject({ value: z.string(), index: indexSchema.optional() }),
		]),
	),
]);
export type FillTarget = z.infer<typeof fieldTargetSchema>;
export type SelectTarget = FillTarget;

const actionStepSchema = z.union([
	z.strictObject({ goto: z.string() }),
	z.strictObject({ click: clickTargetSchema }),
	z.strictObject({ fill: fieldTargetSchema }),
	z.strictObject({ select: fieldTargetSchema }),
	z.strictObject({ screenshot: z.union([z.literal(true), z.string()]) }),
	z.strictObject({ console: z.enum(["error", "warning", "all"]) }),
	z.strictObject({ network: z.literal(true) }),
	z.strictObject({ wait: waitConditionSchema }),
	z.strictObject({ assert: assertConditionSchema }),
	z.strictObject({ login: z.string() }),
	z.strictObject({ snapshot: z.literal(true) }),
	z.strictObject({ wipe: z.literal(true) }),
]);

export type FlowStep =
	| z.infer<typeof actionStepSchema>
	| { if: { condition: FlowCondition; then: FlowStep[]; else?: FlowStep[] } }
	| {
			while: {
				condition: FlowCondition;
				steps: FlowStep[];
				maxIterations?: number;
			};
	  };

const flowStepSchema: z.ZodType<FlowStep> = z.lazy(() =>
	z.union([
		actionStepSchema,
		z.strictObject({
			if: z.strictObject({
				condition: flowConditionSchema,
				// biome-ignore lint/suspicious/noThenProperty: this is a Zod schema for a flow branch.
				then: z.array(flowStepSchema),
				else: z.array(flowStepSchema).optional(),
			}),
		}),
		z.strictObject({
			while: z.strictObject({
				condition: flowConditionSchema,
				steps: z.array(flowStepSchema),
				maxIterations: z.number().int().nonnegative().optional(),
			}),
		}),
	]),
);

export const flowSchema = z.strictObject({
	description: z.string().optional(),
	variables: z.array(z.string()).optional(),
	steps: z.array(flowStepSchema).min(1),
});
export type FlowConfig = z.infer<typeof flowSchema>;

export const commandSettingsSchema = z.strictObject({
	environments: z.record(z.string(), environmentSchema).optional(),
	flows: z.record(z.string(), flowSchema).optional(),
	permissions: z.record(z.string(), permissionSchema).optional(),
	healthcheck: z
		.strictObject({ pages: z.array(healthcheckPageSchema).min(1) })
		.optional(),
	artifacts: artifactsSchema.optional(),
	timeout: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
});

export type CommandConfig = z.infer<typeof commandSettingsSchema> & {
	projectDir?: string;
};

export function trustsConfiguredLogin(): boolean {
	const value = process.env[TRUST_PROJECT_CONFIG_ENV];
	return value === "1" || value === "true";
}
