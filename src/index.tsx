import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Icon,
  List,
  LocalStorage,
  Toast,
  confirmAlert,
  showToast,
} from "@raycast/api";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { useEffect, useMemo, useState } from "react";

const execFileAsync = promisify(execFile);
const HISTORY_KEY = "dictionary-history-v1";
const MAX_HISTORY = 500;

type HistoryItem = {
  word: string;
  definition: string;
  queryTime: string;
  queryCount: number;
};

type FormattedDefinition = {
  pronunciation?: string;
  markdown: string;
};

function formatDefinition(
  word: string,
  definition: string,
): FormattedDefinition {
  const normalized = definition.normalize("NFC").replace(/\s+/g, " ").trim();
  const sections = normalized.split(" | ");
  const pronunciation = sections.length >= 3 ? sections[1]?.trim() : undefined;
  let body =
    sections.length >= 3 ? sections.slice(2).join(" | ").trim() : normalized;

  // Put parts of speech and numbered senses on their own lines, like Dictionary.app.
  body = body
    .replace(/\s+([A-D])\.\s+/g, "\n\n## $1. ")
    .replace(/\s+([①②③④⑤⑥⑦⑧⑨⑩])\s*/g, "\n\n### $1 ")
    .trim();

  const firstHeading = body.match(
    /^(noun|verb|adjective|adverb|pronoun|preposition|conjunction|interjection|exclamation)(?=\s|$)/i,
  );
  if (firstHeading) {
    body = `## ${firstHeading[0]}${body.slice(firstHeading[0].length)}`;
  }

  // Emphasize grammar labels without changing their text.
  body = body.replace(
    /\b(countable and uncountable|uncountable|countable|transitive verb|intransitive verb)\b/gi,
    "*$1*",
  );

  return {
    pronunciation,
    markdown: [
      `# ${word}`,
      pronunciation ? `*${pronunciation}*` : "",
      "---",
      body,
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

async function defineWord(word: string): Promise<string> {
  const script = `
    import Foundation
    import CoreServices
    let word = CommandLine.arguments[1]
    guard let value = DCSCopyTextDefinition(
      nil,
      word as CFString,
      CFRange(location: 0, length: word.utf16.count)
    )?.takeRetainedValue() as String? else { exit(2) }
    print(value)
  `;

  try {
    const { stdout } = await execFileAsync(
      "/usr/bin/swift",
      ["-e", script, word],
      {
        timeout: 15_000,
        maxBuffer: 1024 * 1024,
      },
    );
    const definition = stdout.trim();
    if (!definition) throw new Error("not found");
    return definition;
  } catch {
    throw new Error(`没有找到“${word}”的释义`);
  }
}

async function readHistory(): Promise<HistoryItem[]> {
  const value = await LocalStorage.getItem<string>(HISTORY_KEY);
  if (!value) return [];
  try {
    return JSON.parse(value) as HistoryItem[];
  } catch {
    return [];
  }
}

async function writeHistory(history: HistoryItem[]) {
  await LocalStorage.setItem(
    HISTORY_KEY,
    JSON.stringify(history.slice(0, MAX_HISTORY)),
  );
}

function csvField(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function chooseExportPath(): Promise<string | undefined> {
  const script = `
    set destination to choose file name with prompt "选择词典历史导出位置" default name "Raycast Dictionary History.csv"
    POSIX path of destination
  `;
  try {
    const { stdout } = await execFileAsync("/usr/bin/osascript", [
      "-e",
      script,
    ]);
    return stdout.trim() || undefined;
  } catch {
    // The user cancelled the native save dialog.
    return undefined;
  }
}

async function exportHistory(history: HistoryItem[]) {
  if (history.length === 0) {
    await showToast({
      style: Toast.Style.Failure,
      title: "没有可导出的查询记录",
    });
    return;
  }

  const exportPath = await chooseExportPath();
  if (!exportPath) return;
  const rows = history.map((item) =>
    [
      item.word,
      item.definition,
      new Date(item.queryTime).toLocaleString("zh-CN", { hour12: false }),
      item.queryCount,
    ]
      .map(csvField)
      .join(","),
  );
  const csv = `\uFEFFword,definition,query_time,query_count\n${rows.join("\n")}\n`;
  await writeFile(exportPath, csv, "utf8");
  await showToast({
    style: Toast.Style.Success,
    title: `已导出 ${history.length} 个单词`,
    message: exportPath,
  });
}

export default function Command() {
  const [searchText, setSearchText] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    readHistory().then((items) => {
      setHistory(items);
      setIsLoading(false);
    });
  }, []);

  const exactMatch = history.find(
    (item) =>
      item.word.toLocaleLowerCase() === searchText.trim().toLocaleLowerCase(),
  );
  const visibleHistory = useMemo(() => history, [history]);

  async function lookup(requestedWord?: string) {
    const word = (requestedWord ?? searchText).trim();
    if (!word) return;

    setIsLoading(true);
    try {
      const rawDefinition = await defineWord(word);
      const definition = rawDefinition.normalize("NFC").trim();
      const old = history.find(
        (item) => item.word.toLocaleLowerCase() === word.toLocaleLowerCase(),
      );
      const nextItem: HistoryItem = {
        word,
        definition,
        queryTime: new Date().toISOString(),
        queryCount: (old?.queryCount ?? 0) + 1,
      };
      const next = [nextItem, ...history.filter((item) => item !== old)];
      setHistory(next);
      await writeHistory(next);
      setSearchText("");
      await showToast({ style: Toast.Style.Success, title: `已记录 ${word}` });
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "查询失败",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function remove(item: HistoryItem) {
    const next = history.filter((entry) => entry !== item);
    setHistory(next);
    await writeHistory(next);
  }

  async function clearAllHistory() {
    if (history.length === 0) {
      await showToast({
        style: Toast.Style.Failure,
        title: "没有可清除的历史记录",
      });
      return;
    }

    const confirmed = await confirmAlert({
      title: "清除全部历史记录？",
      message: `将永久删除全部 ${history.length} 条查词记录，此操作无法撤销。`,
      primaryAction: {
        title: "清除全部",
        style: Alert.ActionStyle.Destructive,
      },
    });
    if (!confirmed) return;

    setHistory([]);
    await LocalStorage.removeItem(HISTORY_KEY);
    await showToast({
      style: Toast.Style.Success,
      title: "已清除全部历史记录",
    });
  }

  return (
    <List
      isLoading={isLoading}
      isShowingDetail
      searchBarPlaceholder="Search word..."
      searchText={searchText}
      onSearchTextChange={setSearchText}
      throttle
    >
      {searchText.trim() && !exactMatch ? (
        <List.Item
          icon={{ source: Icon.MagnifyingGlass, tintColor: Color.Blue }}
          title={`查询 “${searchText.trim()}”`}
          subtitle="按 Enter 查询并保存"
          detail={
            <List.Item.Detail
              markdown={`# ${searchText.trim()}\n\n按 **Enter** 使用 macOS Dictionary 查询。`}
            />
          }
          actions={
            <ActionPanel>
              <Action
                title="查询并保存"
                icon={Icon.MagnifyingGlass}
                onAction={() => lookup()}
              />
              <Action
                title="导出全部历史为 CSV"
                icon={Icon.Download}
                onAction={() => exportHistory(history)}
              />
            </ActionPanel>
          }
        />
      ) : null}

      <List.Section title="Recent Words" subtitle={`${visibleHistory.length}`}>
        {visibleHistory.map((item) => {
          const formatted = formatDefinition(item.word, item.definition);
          return (
            <List.Item
              key={`${item.word}-${item.queryTime}`}
              icon={Icon.Book}
              title={item.word}
              accessories={[{ text: `${item.queryCount}×` }]}
              detail={<List.Item.Detail markdown={formatted.markdown} />}
              actions={
                <ActionPanel>
                  <Action.CopyToClipboard
                    title="复制释义"
                    content={`${item.word}\n${item.definition}`}
                  />
                  <Action
                    title="重新查询"
                    icon={Icon.RotateClockwise}
                    onAction={() => {
                      setSearchText(item.word);
                      void lookup(item.word);
                    }}
                  />
                  <Action
                    title="导出全部历史为 CSV"
                    icon={Icon.Download}
                    onAction={() => exportHistory(history)}
                  />
                  <Action
                    title="删除历史记录"
                    icon={Icon.Trash}
                    style={Action.Style.Destructive}
                    onAction={() => remove(item)}
                  />
                  <Action
                    title="清除全部历史记录"
                    icon={Icon.XMarkCircle}
                    style={Action.Style.Destructive}
                    onAction={clearAllHistory}
                  />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>

      {!isLoading && history.length === 0 && !searchText.trim() ? (
        <List.EmptyView
          icon={Icon.Book}
          title="还没有查词记录"
          description="在上方输入单词并按 Enter 查询"
        />
      ) : null}
    </List>
  );
}
