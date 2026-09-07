# vehicle_spec_schema.md — `assets/vehicles/*.spec.json` のスキーマ

このスキーマは **Opus（Architect）が確定した仕様であり、変更禁止**である
（`docs/phase-0.5-tasks.md` TASK-05-2 の「`spec.json` のスキーマ」節が正）。
本ドキュメントはその参照用の要約であり、矛盾があれば
`docs/phase-0.5-tasks.md` を正とする。

## 位置づけ

`spec.json` は **見た目（Blender / `tools/blender/build_vehicle.py`）と
物理（Phase 1B の `sim-vehicle`）の共通の正**である。
TASK-05-2 で実際に使うのは `dimensions` / `tyre` / `visual` のみだが、
`engine` / `drivetrain` / `aero` / `brakes`（一部）/ `suspension` は
Phase 1B がそのまま読むため、**値は保持するだけで形式を変えない**こと。

単位はすべて SI（m, kg, s, N, rad）。角度はラジアン。

## トップレベル

| キー | 型 | 用途 |
|------|----|----|
| `schema_version` | int | 現在 `1` |
| `name` | string | オリジナルの車両名（実在チーム/ドライバー名は禁止） |
| `class` | string | 分類の自由文字列（例: `"gt3"`） |
| `dimensions` | object | 見た目と物理の両方が使う寸法 |
| `mass` | object | 質量特性（本タスクでは未使用。保持のみ） |
| `tyre` | object | `front` / `rear` それぞれの半径・幅・リム径 |
| `engine` / `drivetrain` / `aero` / `brakes` / `suspension` | object | Phase 1B 用。本タスクでは値の保持のみ（`brakes.disc_radius_*` のみ幾何に使用） |
| `visual` | object | 見た目のみ。物理側は参照しない |

## `dimensions`（見た目と物理の両方が使う）

| キー | 意味 |
|------|------|
| `length` / `width` / `height` | 全長・全幅・全高 [m] |
| `wheelbase` | ホイールベース [m] |
| `track_front` / `track_rear` | 前後トレッド幅 [m] |
| `front_overhang` / `rear_overhang` | 前後オーバーハング [m] |
| `ride_height_front` / `ride_height_rear` | 前後車高（アンダーボディの地上高）[m] |

**恒等式（ジェネレータが前提とする）**:
`length == wheelbase + front_overhang + rear_overhang`

## `tyre.front` / `tyre.rear`

| キー | 意味 |
|------|------|
| `radius` | タイヤ半径 [m]（ホイール中心の接地高さそのもの） |
| `width` | タイヤ幅 [m] |
| `rim_diameter_in` | リム径 [インチ]（ジェネレータが `* 0.0254 / 2` で半径 [m] に変換） |

## `visual`

| キー | 用途 |
|------|------|
| `body_profile` | ボディのロフト断面を決める寸法（下記） |
| `rear_wing` | リアウイング。`enabled: false` なら生成しない |
| `wheel` | `spoke_count` / `spoke_width` / `dish_depth`（`dish_depth` は現状未使用） |
| `brake_disc` | `drilled`（現状ジオメトリ未反映。質感は UE5 側の想定）/ `vane_count`（内部ベーン数として実ジオメトリに反映） |
| `livery` | `base_color` / `accent_color`。プレースホルダのマテリアル色にのみ使用。本質感は UE5 側 |

### `visual.body_profile`

| キー | 意味 |
|------|------|
| `nose_height` | ノー先端の高さ [m] |
| `roof_height` | ルーフ（フラットデッキ部）の高さ [m]。`dimensions.height` と整合させること（ジェネレータはロフトの最高点をここから作るため、乖離が 2% を超えると `test_dimensions_match_spec` が落ちる） |
| `roof_start_x` / `roof_end_x` | ルーフ平坦区間の前端・後端の X 座標（原点はホイールベース中心）。`roof_start_x > roof_end_x` かつ両方とも `-(wheelbase/2+rear_overhang) < x < wheelbase/2+front_overhang` の範囲内であること |
| `cabin_width` | キャビン（ルーフ〜グラス）区間の全幅 [m] |
| `sill_height` | サイドシル（ボディ側面下端の基準高さ）[m] |
| `front_splitter_depth` | フロントスプリッターの奥行き [m]。ノー先端からこの分だけ後方に生成される（車両全長を超えない） |
| `diffuser_height` | リアディフューザーの後端高さ [m] |

## 原点と向き（変更禁止）

- 原点: **前後軸の中心・左右中心・接地面**（`y = 0` が路面）
- **`+X` が前方、`+Y` が上、`+Z` が右**
- `tools/blender/build_vehicle.py` はこの座標系で全ジオメトリを組み立て、
  Blender のネイティブ座標へは最後に `real_to_blender()` で変換する
  （実測済みの Blender→glTF 軸変換に基づく。同ファイルの docstring 参照）

## マテリアルスロット名（固定・変更禁止）

`M_Body` / `M_Glass` / `M_Carbon` / `M_Tyre` / `M_WheelRim` / `M_BrakeDisc` / `M_Caliper`

UE5 側はこの名前でスロットを検索する。Blender 側では割り当てのみ行い、
質感（PBR テクスチャ等）は UE5 側で作る（ADR-0006）。

## IP ポリシー

数値は実在の車両カテゴリの公開されている実測寸法・仕様を参照してよいが、
実在チーム名・ドライバー名・スポンサーロゴ・特定チームの配色・実在サーキット名を
成果物に含めてはならない。`GT Proto A` はオリジナルの車両名である。
