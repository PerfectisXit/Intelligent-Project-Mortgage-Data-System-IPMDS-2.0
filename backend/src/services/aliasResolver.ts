export interface AliasCandidate {
  canonical: string;
  score: number;
  reason: string;
}

const builtInAliasMap: Record<string, string[]> = {
  "中建": ["中建三局", "中建八局"],
  "中交": ["中交一公局第二工程有限公司", "中交建筑"]
};

export function resolveAlias(input: string): AliasCandidate[] {
  const candidates: AliasCandidate[] = [];
  for (const [alias, names] of Object.entries(builtInAliasMap)) {
    if (input.includes(alias)) {
      names.forEach((name, idx) => {
        candidates.push({
          canonical: name,
          score: Number((0.88 - idx * 0.06).toFixed(2)),
          reason: `命中别名字典: ${alias}`
        });
      });
    }
  }
  return candidates;
}
