# 逆像 Reverse Prompt

把一张参考图拆解成可编辑、可复制的通用图片提示词。

## 当前版本

这是一个无需构建即可运行的高保真 Web MVP，已包含：

- 图片拖拽与文件上传（JPG / PNG / WEBP，10MB 限制）
- 示例图与扫描分析动效
- 中文 / 英文提示词
- 简洁 / 平衡 / 电影级三档描述精度
- 主体选区移动与四角缩放
- 提示词复制与 TXT 导出
- 桌面端与移动端响应式布局、键盘快捷键与减少动效支持

通过服务端接入火山方舟视觉模型，执行“专业观察 → 视觉证据复核 → 提示词编排”三阶段 Agent 分析。直接用 `file://` 打开时仍会使用本地演示结果。

## 本地运行

1. 在火山方舟控制台撤销曾暴露的旧 Key，重新创建一枚 Key。
2. 复制配置模板：

```bash
cp .env.example .env
```

3. 打开 `.env`，填写重新创建的 `ARK_API_KEY`。默认视觉理解模型为持续跟随最新版的 `doubao-seed-evolving`，并通过方舟 `Responses API` 调用。不要把 `.env` 提交到 Git。
4. 启动服务：

```bash
npm start
```

5. 打开 `http://127.0.0.1:4173`。不要再使用 `file://` 地址测试真实分析。

健康检查：

```bash
curl http://127.0.0.1:4173/api/health
```

该接口只返回是否已配置，不会返回 Key。

## 分析接口

推荐接口：

```http
POST /api/analyze
Content-Type: application/json

{
  "fullImage": "data:image/jpeg;base64,...",
  "subjectImage": "data:image/jpeg;base64,...",
  "roi": { "x": 0.31, "y": 0.26, "width": 0.37, "height": 0.44 },
  "language": "zh",
  "detail": "balanced"
}
```

响应结构：

```json
{
  "fingerprint": ["电影感远景", "冷调漫射光", "极简构图"],
  "prompt": "...",
  "confidence": 0.91,
  "analysis": {},
  "meta": { "model": "...", "stages": 3 }
}
```

安全措施包括：Key 仅从服务端环境变量读取、请求体大小限制、同 IP 限流、图片格式校验、模型超时、静态文件白名单、不记录图片内容。

## 产品下一步

1. 增加人工标注评测集，持续测量主体、构图、光线和色彩准确率。
2. 让用户指定“只分析光影”或“只分析人物造型”。
3. 将画面指纹变成可删除、可调权重的提示词积木。
4. 保存历史记录并支持 A/B 对比两版提示词。
5. 增加“避开原图复刻”选项，保留视觉语言但主动改写主体与构图。
