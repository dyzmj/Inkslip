---
title: Markdown 语法示例
---

# Markdown 语法示例

[toc]

## 列表

- **无序列表**支持格式
  - 嵌套列表与 *斜体*
    - 第三层
- 第二个条目

3. 从三开始
4. 有序列表
    1. 嵌套有序条目

- [ ] 待办任务
- [x] 已完成任务

> 引用中的段落
>
> - 引用中的列表
> > 嵌套引用

## 表格

| 左对齐 | 居中 | 右对齐 |
| :--- | :---: | ---: |
| **粗体** | *斜体* | `code` |
| a\|b | [链接][site] | ~~删除线~~ |

## 图片

![本地中文路径](<./图片 空格.svg> "本地图片")

![引用式图片][photo]

<img src="./图片%20空格.svg" alt="HTML 图片" width="180">

## 行内语法

**粗体**、*斜体*、~~删除线~~、`行内代码`、==高亮==、H~2~O、X^2^、:smile:。

[引用式链接][site]、<https://example.com>、https://example.com、\*转义\* 与 &amp; 实体。

第一行后两个空格  
强制换行。

## 连续文本

连续文本第一行
**连续文本第二行**
连续文本第三行

## 代码

```javascript
const message = '代码高亮';
console.log(message);
```

    缩进代码块
    不会成为段落

Setext 标题
-----------

## 公式与脚注

行内公式 $E=mc^2$，脚注引用[^note]。

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

[^note]: 脚注支持 **粗体** 和 [链接][site]。

术语
: 定义列表解释

*[HTML]: 超文本标记语言

HTML 支持缩写提示。

> [!NOTE]
> 提示块支持 Markdown 内容。

## 图表

```mermaid
flowchart LR
  A[Markdown 原文] --> B[完整解析]
  B --> C[块级呈现]
```

## HTML

<details><summary>展开详情</summary><p><em>HTML 内容</em></p></details>

---

[site]: https://example.com "引用链接"
[photo]: ./图片%20空格.svg "引用图片"

示例结束。点击任意排版块编辑原文，点击任务框切换状态。
