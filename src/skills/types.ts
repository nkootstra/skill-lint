export interface SkillMetadata {
  title: string;
  description?: string;
  triggers?: string[];
  tags?: string[];
  author?: string;
  version?: string;
  [key: string]: unknown;
}

export interface SkillReference {
  /** Filename of the reference */
  name: string;
  /** Absolute path */
  filePath: string;
  /** Text content (if readable) */
  content: string;
}

export interface Skill {
  /** Absolute path to the skill file */
  filePath: string;
  /** Relative path from skills directory */
  relativePath: string;
  /** Skill directory name (e.g., "code-review") */
  skillName: string;
  /** File format: markdown, yaml, or json */
  format: "markdown" | "yaml" | "json";
  /** Parsed metadata/frontmatter */
  metadata: SkillMetadata;
  /** The full instruction body */
  instructions: string;
  /** Raw file content */
  rawContent: string;
  /** Reference files from the references/ subdirectory */
  references: SkillReference[];
}

export interface EvalTestCase {
  /** Test case name/description */
  name: string;
  /** The input prompt to send to the skill */
  prompt: string;
  /** Expected behavior or output pattern */
  expected: string;
  /** Optional: regex pattern the output must match */
  match_pattern?: string;
  /** Optional: keywords that must appear in the output */
  required_keywords?: string[];
  /** Optional: keywords that must NOT appear in the output */
  forbidden_keywords?: string[];
  /** Optional: maximum acceptable token usage */
  max_tokens?: number;
}

export interface EvalFile {
  /** Path to the eval file */
  filePath: string;
  /** The skill this eval is for */
  skillPath: string;
  /** Test cases */
  tests: EvalTestCase[];
}

export interface LintIssue {
  rule: string;
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  suggestion?: string;
}

export interface EvalResult {
  testCase: EvalTestCase;
  passed: boolean;
  output: string;
  score?: number;
  reasoning?: string;
  tokens_used: number;
  latency_ms: number;
}

export interface BenchmarkResult {
  skill: string;
  total_tests: number;
  passed: number;
  failed: number;
  pass_rate: number;
  avg_tokens: number;
  avg_latency_ms: number;
  total_tokens: number;
}

export interface ComparisonResult {
  skill: string;
  base_benchmark: BenchmarkResult | null;
  head_benchmark: BenchmarkResult;
  delta: {
    pass_rate: number;
    avg_tokens: number;
    avg_latency_ms: number;
  } | null;
}

export interface SkillEvaluationResult {
  skill: Skill;
  lint_issues: LintIssue[];
  eval_results: EvalResult[];
  benchmark: BenchmarkResult;
  comparison: ComparisonResult | null;
  suggestions: string[];
}
