import { describe, expect, it } from "vitest";
import { clean, extractAid, parseItems, parseList } from "../src/parse";
import headlines from "./fixtures/headlines.html?raw";
import rss from "./fixtures/rss.xml?raw";
import world from "./fixtures/world.html?raw";

describe("clean", () => {
  it("剝掉 CDATA 與標籤、壓縮空白", () => {
    expect(clean("<![CDATA[  <span>標題</span>\n  第二行 ]]>")).toBe(
      "標題 第二行",
    );
  });

  it("還原實體，且 &amp; 最後處理，不會二次還原", () => {
    expect(clean("A &amp;lt; B &lt; C &quot;D&quot; &#39;E&apos;&nbsp;F")).toBe(
      `A &lt; B < C "D" 'E' F`,
    );
  });

  // 現況紀錄：JS 的 \s 包含全形空白 U+3000，中央社標題裡的「　」會被壓成半形空白。
  // 這是既有行為，refactor 不改；要改的話請連同這條測試一起改。
  it("全形空白會被壓成半形空白", () => {
    expect(clean("颱風生成　最快25日")).toBe("颱風生成 最快25日");
  });
});

describe("extractAid", () => {
  it("優先取 guid 末 12 碼", () => {
    expect(
      extractAid(
        "CNA/2026-09-24/202609240002",
        "https://www.cna.com.tw/news/aopl/209901010001.aspx",
      ),
    ).toBe("202609240002");
  });

  it("guid 不是 ID 格式時退回連結", () => {
    expect(
      extractAid(
        "https://www.cna.com.tw/news/aopl/202609240002.aspx",
        "https://www.cna.com.tw/news/aopl/202609240002.aspx",
      ),
    ).toBe("202609240002");
  });

  it("兩者都抽不出來時回空字串", () => {
    expect(extractAid("abc", "https://example.com/")).toBe("");
  });
});

describe("parseItems", () => {
  it("抽出 guid、aid、標題、連結、訊頭", () => {
    const items = parseItems(rss, 15);
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({
      guid: "CNA/2026-09-24/202609240002",
      aid: "202609240002",
      title: "伊朗總統聯大發表強硬演說 矢言不向美屈服投降",
      link: "https://www.cna.com.tw/news/aopl/202609240002.aspx",
      head: "（中央社紐約聯合國總部23日綜合外電報導）",
    });
    expect(items[1].head).toBe("（中央社記者黃自強吉隆坡23日專電）");
  });

  it("遵守 max 上限", () => {
    expect(parseItems(rss, 2)).toHaveLength(2);
  });

  it("連續呼叫結果一致（全域正則的 lastIndex 有歸零）", () => {
    expect(parseItems(rss, 15)).toEqual(parseItems(rss, 15));
  });

  it("沒有 guid 時用連結當識別碼；沒有標題的跳過；description 沒訊頭時為空字串", () => {
    const xml = `
      <item><title>有標題</title><link>https://www.cna.com.tw/news/aipl/202609240001.aspx</link>
        <description>沒有訊頭的前言</description></item>
      <item><title></title><link>https://www.cna.com.tw/news/aipl/202609240002.aspx</link></item>`;
    expect(parseItems(xml, 15)).toEqual([
      {
        guid: "https://www.cna.com.tw/news/aipl/202609240001.aspx",
        aid: "202609240001",
        title: "有標題",
        link: "https://www.cna.com.tw/news/aipl/202609240001.aspx",
        head: "",
      },
    ]);
  });
});

describe("parseList", () => {
  it("只抽 jsMainList 裡的正規新聞稿，影音連結被白名單擋掉", () => {
    const picks = parseList(headlines);
    expect(picks.map((p) => p.aid)).toEqual([
      "202609230359",
      "202609230341",
      "202609230330",
      "202609230336",
    ]);
    expect(picks[0]).toEqual({
      aid: "202609230359",
      slug: "ahel",
      title: "颱風舒力基生成 最快25日增強中颱、發布警報機會低",
      url: "https://www.cna.com.tw/news/ahel/202609230359.aspx",
      pubAt: Date.parse("2026-09-23T22:14:00+08:00"),
    });
  });

  it("專題頁與聚焦同一套結構", () => {
    const picks = parseList(world);
    expect(picks.map((p) => p.aid)).toEqual([
      "202609213004",
      "202609193001",
      "202609173001",
    ]);
    expect(picks.every((p) => p.slug === "aopl")).toBe(true);
  });

  it("找不到 jsMainList 或結尾時回空陣列", () => {
    expect(parseList("<html><ul><li>x</li></ul></html>")).toEqual([]);
    expect(parseList('<ul id="jsMainList"><li>沒有結尾')).toEqual([]);
  });

  it("datetime 缺漏或無法解析時 pubAt 為 null", () => {
    const html = `<ul id="jsMainList">
      <li><a href="/news/aipl/202609240001.aspx"><h2>甲</h2><time datetime="不是日期"></time></a></li>
      <li><a href="/news/aipl/202609240002.aspx"><h2>乙</h2></a></li>
      <li><a href="/news/aipl/202609240003.aspx"><h2></h2></a></li></ul>`;
    expect(parseList(html).map((p) => [p.aid, p.pubAt])).toEqual([
      ["202609240001", null],
      ["202609240002", null],
    ]);
  });
});
