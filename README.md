# ruleset

自用 **Quantumult X** 分流规则集。规则统一为 [官方 sample 格式](https://github.com/crossutility/Quantumult-X/blob/master/sample.conf) 的小写写法（`host` / `host-suffix` / `host-keyword` / `ip-cidr` 等），并通过 GitHub Actions **每日自动**从上游拉取、转换后写回本仓库。

> 本项目不生产规则，只做整理、格式转换与镜像备份。所有功劳属于原作者。

---

## 目录结构

```text
QuantumultX/
  Filter/          # 分流列表（.list）
    ai.list
    Apple.list
    Finance.list
    Global.list
    Telegram.list
    Twitter.list
    YouTube.list
    APN.list       # 自维护
    Porn.list      # 自维护
scripts/
  update_filters.py
.github/workflows/
  update-filters.yml
```

---

## 使用方式

在 Quantumult X 配置的 `[filter_remote]` 中引用 raw 链接，例如：

```ini
[filter_remote]
https://raw.githubusercontent.com/WhiteBalance2800K/ruleset/main/QuantumultX/Filter/ai.list, tag=AI, force-policy=Proxy, update-interval=86400, enabled=true
https://raw.githubusercontent.com/WhiteBalance2800K/ruleset/main/QuantumultX/Filter/Telegram.list, tag=Telegram, force-policy=Proxy, update-interval=86400, enabled=true
https://raw.githubusercontent.com/WhiteBalance2800K/ruleset/main/QuantumultX/Filter/Finance.list, tag=Finance, force-policy=Proxy, update-interval=86400, enabled=true
```

`force-policy` 会覆盖 list 内自带的策略名，请改成你自己的策略组名称。

---

## 自动更新

- Workflow：`.github/workflows/update-filters.yml`
- 脚本：`scripts/update_filters.py`
- 计划：每天 UTC 16:00（约北京时间次日 00:00），也可在 Actions 页手动 **Run workflow**
- 提交身份：`WhiteBalance2800K`

本地手动更新：

```bash
python3 scripts/update_filters.py
```

---

## 规则来源与致谢

感谢以下项目与作者的开源分享。本仓库中自动更新的规则均来自他们（或在其基础上做 QX 官方格式转换）：

| 用途 | 项目 | 地址 |
|------|------|------|
| AI 域名 / ChatGPT Voice IP | **SukkaW/Surge**（规则站 [ruleset.skk.moe](https://ruleset.skk.moe)） | https://github.com/SukkaW/Surge |
| 金融 / 券商等 | **MetaCubeX/meta-rules-dat**（`geosite/category-finance`） | https://github.com/MetaCubeX/meta-rules-dat |
| 金融分类原始数据 | **v2fly/domain-list-community** | https://github.com/v2fly/domain-list-community |
| Apple / Telegram / Twitter / YouTube / Global 等 | **blackmatrix7/ios_rule_script** | https://github.com/blackmatrix7/ios_rule_script |
| 格式参考（官方 sample） | **crossutility/Quantumult-X** | https://github.com/crossutility/Quantumult-X |

### 对应上游直链（便于核对）

**AI**

- https://ruleset.skk.moe/List/non_ip/ai.conf  
- https://ruleset.skk.moe/List/ip/ai.conf  

**Finance**

- https://raw.githubusercontent.com/MetaCubeX/meta-rules-dat/meta/geo/geosite/category-finance.list  

**blackmatrix7（示例）**

- https://github.com/blackmatrix7/ios_rule_script/tree/master/rule/QuantumultX  

若上游许可协议有要求，请以各仓库 LICENSE 为准；使用本镜像规则时请同时尊重原作者的许可与声明。

---

## 免责声明

- 规则仅供学习与个人网络优化参考，请遵守当地法律法规与服务条款。  
- 上游内容可能变更或失效，本仓库不做可用性保证。  
- 误拦、漏拦等请优先向对应上游项目反馈，或自行维护本地规则。  

---

## License

各 list 文件版权与许可归属原作者 / 原项目。本仓库的脚本与配置编排部分如无另行说明，可按与上游兼容的方式使用；转载请保留致谢与上游链接。
