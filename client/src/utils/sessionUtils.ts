import type { TtydSession } from "../hooks/useSocket";

function getParentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash >= 0 ? path.substring(0, lastSlash) : "";
}

function getBaseName(path: string): string {
  return path.substring(path.lastIndexOf("/") + 1);
}

/**
 * セッションが指定されたリポジトリに属するかどうかを判定する
 */
export function isSessionBelongsToRepo(
  session: TtydSession,
  repoPath: string
): boolean {
  const { worktreePath } = session;

  if (worktreePath === repoPath) return true;

  const repoParent = getParentPath(repoPath);
  const repoName = getBaseName(repoPath);
  const worktreeParent = getParentPath(worktreePath);
  const worktreeName = getBaseName(worktreePath);

  return worktreeParent === repoParent && worktreeName.startsWith(`${repoName}-`);
}

/**
 * セッションが属するリポジトリをrepoListから検索する
 */
export function findRepoForSession(
  session: TtydSession,
  repoList: string[]
): string | null {
  for (const repo of repoList) {
    if (isSessionBelongsToRepo(session, repo)) {
      return repo;
    }
  }
  return null;
}
