/// <reference path="../types.d.ts" />
// @ts-check
// Hergent Desktop — Markdown Renderer (zero-dependency)
// Extracted from app.js Phase 2

function renderMarkdown(text) {
  if (!text) return "";
  // 1. Escape HTML
  var html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // 2. Extract code blocks → placeholders
  var codeBlocks = [];
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, function(_, lang, code) {
    var idx = codeBlocks.length;
    codeBlocks.push('<pre><code class="language-' + (lang || "") + '">' + code.replace(/\n+$/, "").replace(/^\n+/, "") + "</code></pre>");
    return "\x00CB" + idx + "\x00";
  });

  // 3. Block-level processing
  var lines = html.split("\n");
  var result = [];
  var i = 0;
  var inList = null, inTable = false, tableHtml = [];

  while (i < lines.length) {
    var raw = lines[i];
    var line = raw.trim();

    // Table detection
    if (inTable) {
      if (line.indexOf("|") === 0 && line.lastIndexOf("|") === line.length - 1) {
        if (!/^\|[\s\-:]+\|$/.test(line)) {
          var cells = line.split("|").slice(1, -1).map(function(c) { return "<td>" + c.trim() + "</td>"; }).join("");
          tableHtml.push("<tr>" + cells + "</tr>");
        }
        i++; continue;
      } else {
        result.push("<table>" + tableHtml.join("") + "</table>");
        inTable = false; tableHtml = [];
        continue;
      }
    }
    if (line.indexOf("|") === 0 && line.lastIndexOf("|") === line.length - 1 && raw.indexOf("|") !== raw.lastIndexOf("|")) {
      var hcells = line.split("|").slice(1, -1).map(function(c) { return "<th>" + c.trim() + "</th>"; }).join("");
      tableHtml.push("<tr>" + hcells + "</tr>");
      var nextLine = (lines[i+1] || "").trim();
      if (nextLine.indexOf("|") === 0 && /^\|[\s\-:]+\|$/.test(nextLine)) {
        inTable = true; i += 2; continue;
      } else { tableHtml = []; }
    }

    // Headings
    if (/^#{1,4}\s/.test(line)) {
      if (inList) { result.push(inList === "ul" ? "</ul>" : "</ol>"); inList = null; }
      var m = line.match(/^(#{1,4})\s+(.+)/);
      result.push("<h" + m[1].length + ">" + m[2] + "</h" + m[1].length + ">");
      i++; continue;
    }

    // Blockquote
    if (raw.indexOf(">") === 0) {
      if (inList) { result.push(inList === "ul" ? "</ul>" : "</ol>"); inList = null; }
      result.push("<blockquote>" + raw.replace(/^>\s?/, "") + "</blockquote>");
      i++; continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line)) {
      if (inList) { result.push(inList === "ul" ? "</ul>" : "</ol>"); inList = null; }
      result.push("<hr>");
      i++; continue;
    }

    // Unordered list
    if (/^[-*]\s/.test(raw)) {
      if (inList !== "ul") {
        if (inList) result.push("</ol>");
        result.push("<ul>");
        inList = "ul";
      }
      result.push("<li>" + raw.replace(/^[-*]\s+/, "") + "</li>");
      i++; continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(raw)) {
      if (inList !== "ol") {
        if (inList) result.push("</ul>");
        result.push("<ol>");
        inList = "ol";
      }
      result.push("<li>" + raw.replace(/^\d+\.\s+/, "") + "</li>");
      i++; continue;
    }

    // Exit list
    if (inList) { result.push(inList === "ul" ? "</ul>" : "</ol>"); inList = null; }

    // Empty line → paragraph break
    if (line === "") { result.push("<br>"); i++; continue; }

    // Normal paragraph
    result.push("<p>" + line + "</p>");
    i++;
  }
  if (inList) { result.push(inList === "ul" ? "</ul>" : "</ol>"); }
  if (inTable && tableHtml.length) { result.push("<table>" + tableHtml.join("") + "</table>"); }

  html = result.join("\n");

  // 4. Inline formatting
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>");
  html = html.replace(/(?<!\*)\*(.+?)\*(?!\*)/g, "<em>$1</em>");
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // 5. Links [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="chat-link" target="_blank">$1</a>');

  // 6. Auto-link bare URLs
  html = html.replace(/(https?:\/\/[^\s<>\[\]()]+)/g, '<a href="$1" class="chat-link" target="_blank">$1</a>');

  // 7. Restore code blocks
  html = html.replace(/\x00CB(\d+)\x00/g, function(_, idx) { return codeBlocks[parseInt(idx)]; });

  return html;
}
