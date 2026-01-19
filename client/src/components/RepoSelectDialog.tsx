import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FolderOpen, RefreshCw } from "lucide-react";
import type { RepoInfo } from "../../../shared/types";

interface RepoSelectDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  scannedRepos: RepoInfo[];
  isScanning: boolean;
  onScanRepos: (basePath: string) => void;
  onSelectRepo: (path: string) => void;
}

export function RepoSelectDialog({
  isOpen,
  onOpenChange,
  scannedRepos,
  isScanning,
  onScanRepos,
  onSelectRepo,
}: RepoSelectDialogProps) {
  const [scanBasePath, setScanBasePath] = useState(() => {
    return localStorage.getItem("scanBasePath") || "";
  });
  const [repoInput, setRepoInput] = useState("");

  // スキャンパスをlocalStorageに保存
  useEffect(() => {
    if (scanBasePath) {
      localStorage.setItem("scanBasePath", scanBasePath);
    }
  }, [scanBasePath]);

  const handleScanRepos = () => {
    if (!scanBasePath.trim()) {
      return;
    }
    onScanRepos(scanBasePath.trim());
  };

  const handleSelectRepo = () => {
    if (!repoInput.trim()) {
      return;
    }
    onSelectRepo(repoInput.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange} modal={false}>
      <DialogTrigger asChild>
        <Button variant="outline" className="w-full mt-2 justify-start gap-2 h-12 md:h-10 text-base md:text-sm">
          <FolderOpen className="w-5 h-5 md:w-4 md:h-4" />
          リポジトリを選択
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-card border-border w-[calc(100%-2rem)] max-w-lg mx-auto max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>リポジトリを選択</DialogTitle>
          <DialogDescription>
            ディレクトリパスを入力してスキャンするか、直接リポジトリパスを入力してください。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4 flex-1 overflow-hidden flex flex-col">
          {/* スキャン用入力 */}
          <div className="space-y-2">
            <Label htmlFor="scanPath">スキャンするパス</Label>
            <div className="flex gap-2">
              <Input
                id="scanPath"
                placeholder="/Users/username/dev"
                value={scanBasePath}
                onChange={(e) => setScanBasePath(e.target.value)}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleScanRepos();
                  }
                }}
                className="font-mono h-12 md:h-10 text-base md:text-sm flex-1"
              />
              <Button
                type="button"
                onClick={handleScanRepos}
                disabled={isScanning}
                className="h-12 md:h-10 shrink-0"
              >
                {isScanning ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  "スキャン"
                )}
              </Button>
            </div>
          </div>

          {/* スキャン結果リスト */}
          {scannedRepos.length > 0 && (
            <div className="space-y-2 flex-1 overflow-hidden flex flex-col">
              <Label>検出されたリポジトリ ({scannedRepos.length})</Label>
              <ScrollArea className="flex-1 border rounded-md">
                <div className="p-2 space-y-1">
                  {scannedRepos.map((repo) => (
                    <div
                      key={repo.path}
                      className="p-3 rounded-md hover:bg-accent cursor-pointer transition-colors"
                      onClick={() => {
                        onSelectRepo(repo.path);
                        onOpenChange(false);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <FolderOpen className="w-4 h-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-sm truncate">{repo.name}</span>
                        <span className="text-xs text-muted-foreground">({repo.branch})</span>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-1 truncate pl-6">
                        {repo.path}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <Separator />

          {/* 直接パス入力 */}
          <div className="space-y-2">
            <Label htmlFor="repoPath">または直接パスを入力</Label>
            <Input
              id="repoPath"
              placeholder="/path/to/your/repository"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSelectRepo();
                }
              }}
              className="font-mono h-12 md:h-10 text-base md:text-sm"
            />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-12 md:h-10">
            キャンセル
          </Button>
          <Button type="button" onClick={handleSelectRepo} disabled={!repoInput.trim()} className="glow-green h-12 md:h-10">
            選択
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
