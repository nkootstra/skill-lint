# Code Quality Patterns

## Complexity
- Functions over 30 lines should be split
- Cyclomatic complexity above 10 needs refactoring
- Deep nesting (>3 levels) reduces readability

## Naming
- Variables should describe their purpose
- Boolean variables should read as questions (isActive, hasPermission)
- Avoid abbreviations except well-known ones (id, url, etc.)

## Patterns to Flag
- God objects / classes doing too much
- Duplicate logic that should be extracted
- Magic numbers without named constants
