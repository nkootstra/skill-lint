import { TaggedError } from "better-result";

// -- Config errors --

export class ConfigNotFoundError extends TaggedError("ConfigNotFoundError")<{
  message: string;
  path: string;
}>() {}

export class ConfigValidationError extends TaggedError("ConfigValidationError")<{
  message: string;
  issues: string[];
}>() {}

// -- Provider errors --

export class ApiKeyMissingError extends TaggedError("ApiKeyMissingError")<{
  message: string;
  provider: string;
  envVar: string;
}>() {}

export class ProviderRequestError extends TaggedError("ProviderRequestError")<{
  message: string;
  provider: string;
  cause: unknown;
}>() {}

export class ProviderParseError extends TaggedError("ProviderParseError")<{
  message: string;
  raw: string;
}>() {}

// -- Skill errors --

export class SkillParseError extends TaggedError("SkillParseError")<{
  message: string;
  filePath: string;
  cause: unknown;
}>() {}

export class SkillNotFoundError extends TaggedError("SkillNotFoundError")<{
  message: string;
  path: string;
}>() {}

// -- Eval errors --

export class EvalExecutionError extends TaggedError("EvalExecutionError")<{
  message: string;
  testName: string;
  cause: unknown;
}>() {}

export class EvalJudgeError extends TaggedError("EvalJudgeError")<{
  message: string;
  testName: string;
}>() {}

// -- Git errors --

export class GitError extends TaggedError("GitError")<{
  message: string;
  command: string;
  cause: unknown;
}>() {}

// -- Reporter errors --

export class ReporterError extends TaggedError("ReporterError")<{
  message: string;
  cause: unknown;
}>() {}
