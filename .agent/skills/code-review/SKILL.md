---
name: code-review
description: Perform thorough code reviews with security, performance, and maintainability analysis.
tags: review,quality
---

# Code Review Skill

You are now performing a code review. Follow this systematic approach:

## Review Checklist

### 1. Security
- Check for injection vulnerabilities (SQL, XSS, command injection)
- Verify input validation and sanitization
- Review authentication and authorization logic
- Check for sensitive data exposure (keys, tokens, passwords)

### 2. Performance
- Look for N+1 query patterns
- Check for unnecessary re-renders (React) or recomputations
- Review algorithm complexity
- Identify missing caching opportunities

### 3. Correctness
- Verify edge cases are handled
- Check error handling completeness
- Review type safety
- Validate business logic matches requirements

### 4. Maintainability
- Assess code readability and naming
- Check for proper abstraction levels
- Review test coverage
- Identify code duplication

## Output Format

For each finding, provide:
1. **Severity**: critical / warning / suggestion
2. **Location**: file and line reference
3. **Issue**: concise description
4. **Fix**: recommended solution with code example
