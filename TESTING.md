# TESTING.md — Test Strategy

Last updated: 2026-09-06

---

## 1. 原則

- **「コードが動く」を Complete 条件にしない。** 挙動が仕様を満たすことを数値で検証する
- **「表示された」を Complete 条件にしない。** 映像は評価項目に沿って確認する
- Racing AI は Scenario Test で判定する。各シナリオに Acceptance Criteria を定義する
- Simulation Core は headless で全テストが回る（レンダリング不要）

## 2. テスト種別

| 種別 | 対象 | 実行 |
|------|------|------|
| Unit Test | 関数・データ構造 | `cargo test` |
| Simulation Test | 固定入力での長時間シミュレーション | `cargo test --release` |
| Scenario Test | AI 挙動（初期状態を仕込んで結果を判定） | `cargo test --release` |
| Determinism Test | 同一 Seed の再現性 | `cargo test --release` |
| Regression Test | 既知バグの再発防止 + 基準ラップタイムの変動検知 | CI |
| Performance Test | フレーム予算 | `cargo bench` / 実測 |
| Visual Validation | 映像品質（人間判定 + スクリーンショット比較） | 手動チェックリスト |

---

## 3. Track（Phase 1A）

| ID | 検証内容 | Acceptance |
|----|---------|-----------|
| T-TRK-01 | `track_to_world(world_to_track(p)) == p` | 誤差 < 1e-6 m（コース上の全サンプル点） |
| T-TRK-02 | `s` は 0 <= s < length で単調・連続 | 不連続点なし |
| T-TRK-03 | 曲率 `kappa(s)` が C0 連続 | 隣接サンプル間の差分が閾値内 |
| T-TRK-04 | コース幅が全 s で正 | width_left + width_right > 最小車幅 * 2 |
| T-TRK-05 | 弧長パラメータ化の精度 | スプライン実長と s の誤差 < 0.1% |
| T-TRK-06 | ラップ跨ぎ（s: length-ε -> 0+ε）の検出 | 誤検出・見逃しゼロ |

---

## 4. Vehicle Physics（Phase 1B）

| ID | 検証内容 | Acceptance |
|----|---------|-----------|
| T-VEH-01 | 静止時の 4 輪荷重の合計 = 車両重量 | 誤差 < 0.1% |
| T-VEH-02 | 静止時の前後荷重配分 = 重心位置から算出した値 | 誤差 < 1% |
| T-VEH-03 | 制動時に前輪荷重が増え、車体が **dive** する | pitch 角が負方向へ、荷重移動と整合 |
| T-VEH-04 | 加速時に後輪荷重が増え、車体が **squat** する | pitch 角が正方向へ |
| T-VEH-05 | 定常円旋回で外輪荷重が増え **roll** する | roll 角と横 G が整合 |
| T-VEH-06 | **低速・停止時にタイヤ力が発散しない** | 60 分間 NaN / inf ゼロ、\|F\| < 物理上限 |
| T-VEH-07 | 摩擦円: 縦横合成力が μ*Fz を超えない | 全 tick で超過ゼロ |
| T-VEH-08 | ロックアップがブレーキ過大時に**創発**する | slip_ratio -> -1 に漸近、専用判定コードが存在しない |
| T-VEH-09 | 空力ダウンフォースが速度の 2 乗に比例 | 誤差 < 1% |
| T-VEH-10 | エネルギー保存: 惰行時の減速が抗力+転がり抵抗と整合 | 誤差 < 5% |
| T-VEH-11 | Visual suspension compression == 物理 compression | 完全一致（別系統でない） |

---

## 5. Driver AI（Phase 2 以降）

| ID | 検証内容 | Acceptance |
|----|---------|-----------|
| T-AI-01 | **コース逸脱しない** | 20 周走行で \|t\| が corridor を超える tick が 0（縁石許容分を除く） |
| T-AI-02 | **ステアが不連続に振動しない** | \|d(steer)/dt\| <= max_steer_rate 常時。2 次差分の RMS が閾値内。FFT で 5Hz 以上の卓越ピークなし |
| T-AI-03 | **Waypoint へ瞬間旋回しない** | ステア角の 1 tick 変化量が上限内。目標横位置 t_target が C1 連続 |
| T-AI-04 | **Target speed が異常値にならない** | 0 <= v_target <= v_max_physical、全 tick |
| T-AI-05 | 能力値がラップタイムに創発的に反映 | pace/braking/cornering を変えた 3 名でタイム差が出る。かつ v_max を直接変えていないことをコード検査で確認 |
| T-AI-06 | consistency が低いドライバーはラップ間ばらつきが大きい | 標準偏差の順序が能力値の順序と一致 |
| T-AI-07 | Perception 遅延が効いている | reaction_time を 0 にすると挙動が変わる |
| T-AI-08 | 決定性 | 同一 Seed で 2 回実行し、全車両状態のハッシュが一致 |

### Scenario Test（Phase 4〜5）

| ID | シナリオ | Acceptance Criteria |
|----|---------|-------------------|
| S-01 | 単独コーナリング | ライン追従誤差が閾値内。apex 到達。脱出でトラクション限界を使い切る |
| S-02 | 2 台追走 | 車間が安定。追突ゼロ。ダーティエアで距離が詰まりきらない |
| S-03 | 直線での追い抜き | スリップストリームを使い、`Assess -> Setup -> Commit` を経て成立。瞬間的な横移動なし |
| S-04 | コーナー イン側からの攻撃 | ブレーキング勝負として成立。両者がスペースを残す。接触率 < 15% |
| S-05 | コーナー アウト側からの攻撃 | 脱出で決着 or スイッチバックへ移行 |
| S-06 | ディフェンス | 防御側が 1 move rule を守る。ブレーキング中の進路変更なし |
| S-07 | 並走コーナー | 両者が Alongside フェーズに入り、接触せず脱出 or 一方が引く |
| S-08 | 衝突回避 | 前方の低速車 / スピン車に対し、減速 + 回避軌跡を生成。二次事故率 < 10% |

---

## 6. Race System（Phase 3 以降）

| ID | 検証内容 | Acceptance |
|----|---------|-----------|
| T-RACE-01 | **ラップカウントが正しい** | 24 台 * 50 周で誤計上ゼロ。逆走・停止・ピットでも誤らない |
| T-RACE-02 | **順位ソートが正しい** | 順位が `(laps, s)` の辞書順と常に一致 |
| T-RACE-03 | Gap / Interval の整合 | Gap は単調に増える車列で単調。負値なし |
| T-RACE-04 | セクタータイムの合計 = ラップタイム | 誤差 < 1 ms |
| T-RACE-05 | Fastest Lap / PB が正しく更新 | 全車の記録と突き合わせて一致 |
| T-RACE-06 | **衝突後にシミュレーションが破綻しない** | 接触 100 回で NaN / 貫通 / 吹き飛びゼロ |
| T-RACE-07 | **Race State が不整合にならない** | 不正な状態遷移ゼロ |
| T-RACE-08 | スタートでの多重衝突からの復帰 | 全車が最終的に走行を再開 or 正常にリタイア |
| T-RACE-09 | リタイア処理 | リタイア車が順位・Gap 計算から正しく除外される |
| T-RACE-10 | 長時間安定性 | 24 台 60 分で破綻ゼロ |

---

## 7. Performance

各主要 Phase で測定・記録する（PLAN.md に結果を追記）。

| 指標 | 測定方法 | 予算 |
|------|---------|------|
| Physics tick cost | `cargo bench` (24 cars) | <= 2.0 ms / render frame |
| AI tick cost | `cargo bench` (24 cars) | <= 1.5 ms / render frame |
| Race/Timing cost | `cargo bench` | <= 0.3 ms |
| CPU main thread | エンジンプロファイラ | <= 8.0 ms |
| GPU frame time | エンジンプロファイラ | <= 14.0 ms |
| VRAM | `nvidia-smi` | <= 7.0 GB |
| Memory (sim) | 実測 | <= 512 MB |

**Performance Regression は記録する。** 前 Phase 比で 10% 以上の悪化は HIGH として扱う。

---

## 8. Visual Validation（Phase 8 以降）

チェックリスト方式。「表示された」では合格としない。

- [ ] lighting consistency — 時間帯・天候を変えても破綻しない
- [ ] material realism — カーペイントのクリアコート、カーボンの異方性、ガラスの厚み
- [ ] reflection quality — 走行中に反射がちらつかない、車体が環境を正しく映す
- [ ] camera composition — 実際の中継の構図と比較して違和感がない
- [ ] vehicle scale — 人・ガードレール・縁石との相対サイズが正しい
- [ ] motion quality — ghosting / smearing / shimmering なし
- [ ] **wheel artifacts** — 回転ホイールが TAA/DLSS で滲まない（回転モーションベクタが正しい）
- [ ] shadow stability — カメラ移動でシャドウがちらつかない
- [ ] LOD transitions — 切り替わりが目視で分からない
- [ ] temporal artifacts — 急なパンでゴーストが出ない
- [ ] night visibility — ヘッドライト・テールライト・路面反射
- [ ] rain visibility — スプレー、水膜反射、視界低下

---

## 9. Definition of Done（Phase 完了判定）

Phase を Complete とする条件:

1. 当該 Phase の全 Acceptance Criteria を満たす
2. **CRITICAL / HIGH の未解決 finding がゼロ**
3. 追加された全テストが通過し、既存テストが退行していない
4. Performance 予算を満たす（または逸脱が記録され承認されている）
5. `ARCHITECTURE.md` が実装と一致している
6. Opus のレビューが `APPROVED`
