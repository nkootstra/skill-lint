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

export interface GraderConfig {
  /** Grader type: hard_constraints, llm_rubric, or script */
  type: "hard_constraints" | "llm_rubric" | "script";
  /** Weight of this grader in the final score (0.0-1.0) */
  weight: number;
  /** For hard_constraints: regex pattern the output must match */
  match_pattern?: string;
  /** For hard_constraints: keywords that must appear */
  required_keywords?: string[];
  /** For hard_constraints: keywords that must NOT appear */
  forbidden_keywords?: string[];
  /** For llm_rubric: expected behavior description */
  expected?: string;
  /** For script: shell command to run. Receives agent output via $SKILL_EVAL_OUTPUT env var */
  command?: string;
}

export interface EvalTestCase {
  /** Test case name/description */
  name: string;
  /** The input prompt to send to the skill */
  prompt: string;
  /** Expected behavior or output pattern */
  expected: string;
  /** Optional: numeric id from Anthropic evals.json format */
  id?: number;
  /** Optional: associated files from Anthropic evals.json format */
  files?: string[];
  /** Optional: explicit expectations the LLM judge must verify */
  expectations?: string[];
  /** Optional: regex pattern the output must match */
  match_pattern?: string;
  /** Optional: keywords that must appear in the output */
  required_keywords?: string[];
  /** Optional: keywords that must NOT appear in the output */
  forbidden_keywords?: string[];
  /** Optional: maximum acceptable token usage */
  max_tokens?: number;
  /** Optional: multiple graders with weights for partial credit scoring */
  graders?: GraderConfig[];
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

export interface GraderCheck {
  name: string;
  passed: boolean;
  details?: string;
}

export interface GraderResult {
  grader_type: string;
  score: number;
  weight: number;
  details: string;
  /** Granular pass/fail checks from structured script grader output */
  checks?: GraderCheck[];
}

export interface EvalResult {
  testCase: EvalTestCase;
  passed: boolean;
  output: string;
  score?: number;
  reasoning?: string;
  tokens_used: number;
  latency_ms: number;
  /** Per-grader results when weighted graders are used */
  grader_results?: GraderResult[];
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
  /** Probability of at least 1 success in k trials (capability signal) */
  pass_at_k?: number;
  /** Probability of all k trials succeeding (reliability signal) */
  pass_pow_k?: number;
  /** Number of trials per test case used for pass@k/pass^k */
  trials_per_test?: number;
}

export interface ComparisonResult {
  skill: string;
  base_benchmark: BenchmarkResult | null;
  head_benchmark: BenchmarkResult;
  delta: {
    pass_rate: number;
    avg_tokens: number;
    avg_latency_ms: number;
    /** Normalized gain: (head - base) / (1 - base), accounts for baseline difficulty */
    normalized_gain?: number;
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
