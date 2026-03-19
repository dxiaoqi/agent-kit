// ── Markdown 终端渲染组件 ────────────────────────────────────────
// 将 Markdown 文本解析为 Ink 组件，支持代码高亮和 MarkdownExtension 插槽。

import React from "react";
import { Text, Box } from "ink";
import { useTheme, useRegistry } from "../hooks/use-registry.js";

interface MarkdownProps {
    text: string;
}

export function Markdown({ text }: MarkdownProps) {
    const theme = useTheme();
    const registry = useRegistry();
    const extensions = registry.getMarkdownExtensions();

    const blocks = parseBlocks(text, extensions);

    return (
        <Box flexDirection="column">
            {blocks.map((block, i) => (
                <MarkdownBlock key={i} block={block} theme={theme} extensions={extensions} />
            ))}
        </Box>
    );
}

// ── 简易块级解析器 ───────────────────────────────────────────────

type Block =
    | { type: "heading"; level: number; text: string }
    | { type: "code"; lang: string; code: string }
    | { type: "list_item"; text: string; ordered: boolean; index: number }
    | { type: "blockquote"; text: string }
    | { type: "hr" }
    | { type: "paragraph"; text: string }
    | { type: "extension"; name: string; data: Record<string, unknown> };

function parseBlocks(
    text: string,
    extensions: Array<{ name: string; pattern: RegExp; parse: (m: RegExpMatchArray) => { type: string; raw: string; data: Record<string, unknown> } }>,
): Block[] {
    const blocks: Block[] = [];
    const lines = text.split("\n");
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Extension match
        let extMatched = false;
        for (const ext of extensions) {
            const match = line.match(ext.pattern);
            if (match) {
                blocks.push({ type: "extension", name: ext.name, data: ext.parse(match).data });
                extMatched = true;
                i++;
                break;
            }
        }
        if (extMatched) continue;

        // Heading
        const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            blocks.push({ type: "heading", level: headingMatch[1].length, text: headingMatch[2] });
            i++;
            continue;
        }

        // Horizontal rule
        if (/^[-*_]{3,}\s*$/.test(line)) {
            blocks.push({ type: "hr" });
            i++;
            continue;
        }

        // Fenced code block
        const codeMatch = line.match(/^```(\w*)$/);
        if (codeMatch) {
            const lang = codeMatch[1] || "";
            const codeLines: string[] = [];
            i++;
            while (i < lines.length && !lines[i].startsWith("```")) {
                codeLines.push(lines[i]);
                i++;
            }
            if (i < lines.length) i++; // skip closing ```
            blocks.push({ type: "code", lang, code: codeLines.join("\n") });
            continue;
        }

        // Blockquote
        if (line.startsWith("> ")) {
            const quoteLines: string[] = [];
            while (i < lines.length && lines[i].startsWith("> ")) {
                quoteLines.push(lines[i].slice(2));
                i++;
            }
            blocks.push({ type: "blockquote", text: quoteLines.join("\n") });
            continue;
        }

        // Ordered list
        const olMatch = line.match(/^(\d+)\.\s+(.+)$/);
        if (olMatch) {
            blocks.push({ type: "list_item", text: olMatch[2], ordered: true, index: parseInt(olMatch[1]) });
            i++;
            continue;
        }

        // Unordered list
        const ulMatch = line.match(/^[-*+]\s+(.+)$/);
        if (ulMatch) {
            blocks.push({ type: "list_item", text: ulMatch[1], ordered: false, index: 0 });
            i++;
            continue;
        }

        // Empty line
        if (line.trim() === "") {
            i++;
            continue;
        }

        // Paragraph: collect consecutive non-empty lines
        const paraLines: string[] = [];
        while (i < lines.length && lines[i].trim() !== "" && !lines[i].match(/^#{1,6}\s/) && !lines[i].startsWith("```")) {
            paraLines.push(lines[i]);
            i++;
        }
        if (paraLines.length > 0) {
            blocks.push({ type: "paragraph", text: paraLines.join("\n") });
        }
    }

    return blocks;
}

// ── 块级渲染 ─────────────────────────────────────────────────────

function MarkdownBlock({
    block,
    theme,
    extensions,
}: {
    block: Block;
    theme: import("../theme.js").Theme;
    extensions: Array<{ name: string; render: (token: any, theme: any) => React.ReactNode }>;
}) {
    switch (block.type) {
        case "heading":
            return (
                <Text bold color={theme.brand}>
                    {"#".repeat(block.level)} {renderInline(block.text, theme)}
                </Text>
            );

        case "code":
            return (
                <Box flexDirection="column" marginY={0}>
                    <Text color={theme.secondaryText}>{"```"}{block.lang}</Text>
                    <Text color={theme.suggestion}>{block.code}</Text>
                    <Text color={theme.secondaryText}>{"```"}</Text>
                </Box>
            );

        case "list_item":
            return (
                <Text>
                    <Text color={theme.secondaryText}>
                        {block.ordered ? `${block.index}. ` : "  • "}
                    </Text>
                    {renderInline(block.text, theme)}
                </Text>
            );

        case "blockquote":
            return (
                <Box borderLeft borderColor={theme.secondaryBorder} paddingLeft={1}>
                    <Text color={theme.secondaryText}>{block.text}</Text>
                </Box>
            );

        case "hr":
            return <Text color={theme.secondaryBorder}>{"─".repeat(40)}</Text>;

        case "paragraph":
            return <Text>{renderInline(block.text, theme)}</Text>;

        case "extension": {
            const ext = extensions.find(e => e.name === block.name);
            if (ext) return <>{ext.render({ type: block.name, raw: "", data: block.data }, theme)}</>;
            return <Text>{JSON.stringify(block.data)}</Text>;
        }
    }
}

// ── 行内渲染（简易：bold / code / italic）────────────────────────

function renderInline(text: string, theme: import("../theme.js").Theme): React.ReactNode {
    const parts: React.ReactNode[] = [];
    let remaining = text;
    let keyIdx = 0;

    while (remaining.length > 0) {
        // Inline code
        const codeMatch = remaining.match(/^`([^`]+)`/);
        if (codeMatch) {
            parts.push(
                <Text key={keyIdx++} color={theme.suggestion}>{codeMatch[1]}</Text>
            );
            remaining = remaining.slice(codeMatch[0].length);
            continue;
        }

        // Bold
        const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
        if (boldMatch) {
            parts.push(
                <Text key={keyIdx++} bold>{boldMatch[1]}</Text>
            );
            remaining = remaining.slice(boldMatch[0].length);
            continue;
        }

        // Italic
        const italicMatch = remaining.match(/^\*([^*]+)\*/);
        if (italicMatch) {
            parts.push(
                <Text key={keyIdx++} dimColor>{italicMatch[1]}</Text>
            );
            remaining = remaining.slice(italicMatch[0].length);
            continue;
        }

        // Plain text until next special char
        const nextSpecial = remaining.search(/[`*]/);
        if (nextSpecial === -1) {
            parts.push(<Text key={keyIdx++}>{remaining}</Text>);
            break;
        } else if (nextSpecial > 0) {
            parts.push(<Text key={keyIdx++}>{remaining.slice(0, nextSpecial)}</Text>);
            remaining = remaining.slice(nextSpecial);
        } else {
            parts.push(<Text key={keyIdx++}>{remaining[0]}</Text>);
            remaining = remaining.slice(1);
        }
    }

    return <>{parts}</>;
}
