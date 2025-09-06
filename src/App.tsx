import React, { Suspense, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, useGLTF, Environment, Html } from "@react-three/drei";
import {
  ZapparCanvas,
  ZapparCamera,
  ImageTracker,
} from "@zappar/zappar-react-three-fiber";

/** ===================== シーン計画（LLMで生成する想定のJSON） ===================== */

type Motion = "orbit" | "float" | "none";
type Shape = "sphere" | "box" | "torus" | "icosa";
type MaterialKind = "standard" | "basic" | "toon";

type ObjectSpec = {
  shape: Shape;
  count: number; // 安全のため 1..200 程度に制限
  color?: string; // CSS色
  material?: MaterialKind;
  size?: number; // 基本寸法[m]
  metalness?: number; // 0..1
  roughness?: number; // 0..1
  motion?: Motion;
  radius?: number; // 軌道半径[m]
};

type ScenePlan = {
  objects: ObjectSpec[];
};

/** ========== LLMブリッジ：実運用はAPIへ。ここは暫定の "モック" 変換器 ========== */
/* 例）
   入力:
     "20 red spheres orbit fast, 5 gold torus, add blue boxes floating"
   出力:
     JSONのScenePlan
*/
function planSceneFromTextMock(input: string): ScenePlan {
  const lower = input.toLowerCase();

  const pick = (kw: string, def = 0) => {
    const m = lower.match(new RegExp(`(\\d+)\\s+${kw}`));
    return m ? Math.min(parseInt(m[1], 10), 200) : def;
  };

  const has = (kw: string) => lower.includes(kw);

  const plan: ScenePlan = { objects: [] };

  // 簡易ルール（必要に応じて拡張）
  const spheres = pick("sphere|spheres") || (has("sphere") ? 5 : 0);
  if (spheres)
    plan.objects.push({
      shape: "sphere",
      count: spheres,
      color: has("red") ? "tomato" : has("blue") ? "skyblue" : "#9cf",
      material: has("metal") ? "standard" : "standard",
      metalness: has("metal") ? 0.9 : 0.2,
      roughness: has("metal") ? 0.1 : 0.6,
      motion: has("orbit") ? "orbit" : has("float") ? "float" : "none",
      size: 0.06,
      radius: has("close") ? 0.5 : 1.2,
    });

  const boxes = pick("box|boxes") || (has("box") ? 10 : 0);
  if (boxes)
    plan.objects.push({
      shape: "box",
      count: boxes,
      color: has("blue") ? "deepskyblue" : "#ff9",
      material: has("toon") ? "toon" : "standard",
      metalness: 0.1,
      roughness: 0.8,
      motion: has("float") ? "float" : "orbit",
      size: 0.08,
      radius: 1.0,
    });

  const torus = pick("torus|tori") || (has("torus") ? 3 : 0);
  if (torus)
    plan.objects.push({
      shape: "torus",
      count: torus,
      color: has("gold") ? "#d4af37" : "#faf",
      material: "standard",
      metalness: has("gold") ? 1 : 0.5,
      roughness: has("gold") ? 0.2 : 0.5,
      motion: "orbit",
      size: 0.12,
      radius: 1.4,
    });

  const icosa = pick("icosa|icosahedra") || (has("icosa") ? 6 : 0);
  if (icosa)
    plan.objects.push({
      shape: "icosa",
      count: icosa,
      color: "#aaf",
      material: "standard",
      metalness: 0.2,
      roughness: 0.7,
      motion: "float",
      size: 0.09,
      radius: 0.9,
    });

  if (plan.objects.length === 0) {
    // デフォルト
    plan.objects.push({
      shape: "sphere",
      count: 10,
      color: "#9cf",
      material: "standard",
      metalness: 0.2,
      roughness: 0.7,
      motion: "orbit",
      size: 0.06,
      radius: 1.2,
    });
  }

  return plan;
}

/** ===================== 共通の浮遊オブジェクト群 ===================== */

function materialFrom(kind: MaterialKind, props: any) {
  switch (kind) {
    case "basic":
      return <meshBasicMaterial {...props} />;
    case "toon":
      return <meshToonMaterial {...props} />;
    default:
      return <meshStandardMaterial {...props} />;
  }
}

function ShapeGeometry({
  shape,
  size,
}: {
  shape: Shape;
  size: number;
}): JSX.Element {
  switch (shape) {
    case "box":
      return <boxGeometry args={[size, size, size]} />;
    case "torus":
      return <torusGeometry args={[size * 0.6, size * 0.25, 16, 64]} />;
    case "icosa":
      return <icosahedronGeometry args={[size, 0]} />;
    default:
      return <sphereGeometry args={[size * 0.5, 32, 32]} />;
  }
}

function FloatingObjects({
  spec,
  seed = 1,
}: {
  spec: ObjectSpec;
  seed?: number;
}) {
  const group = useRef<THREE.Group>(null!);
  const instances = useMemo(() => {
    const r = Math.max(spec.radius ?? 1.2, 0.2);
    const items = Array.from({ length: spec.count }).map((_, i) => {
      const ang = ((i + seed) / spec.count) * Math.PI * 2;
      const y = (Math.sin(i * 12.9898 + seed) * 0.5 + 0.5) * 0.6 + 0.2;
      return {
        ang,
        y,
        speed: 0.4 + (i % 7) * 0.03,
        r: r * (0.9 + (i % 5) * 0.02),
      };
    });
    return items;
  }, [spec.count, spec.radius, seed]);

  useFrame((_, dt) => {
    if (!group.current) return;
    group.current.children.forEach((child, i) => {
      const obj = child as THREE.Object3D;
      const it = instances[i];
      if (!it) return;
      if (spec.motion === "orbit") {
        const a = it.ang + it.speed * performance.now() * 0.00015;
        obj.position.set(Math.cos(a) * it.r, it.y, Math.sin(a) * it.r);
        obj.rotation.y += dt * 0.5;
      } else if (spec.motion === "float") {
        obj.position.y = it.y + Math.sin(performance.now() * 0.001 + i) * 0.1;
        obj.rotation.x += dt * 0.3;
        obj.rotation.y += dt * 0.2;
      }
    });
  });

  const color = spec.color ?? "#9cf";
  const commonMatProps = {
    color,
    metalness: spec.metalness ?? 0.2,
    roughness: spec.roughness ?? 0.7,
  };

  return (
    <group ref={group}>
      {instances.map((_, i) => (
        <mesh key={i} castShadow receiveShadow>
          <ShapeGeometry shape={spec.shape} size={spec.size ?? 0.08} />
          {materialFrom(spec.material ?? "standard", commonMatProps)}
        </mesh>
      ))}
    </group>
  );
}

/** ===================== タワーモデル（高さに合わせてフィット） ===================== */

function TowerModel({
  fitHeight = 1.0, // [m] 画面内で見える全高
  url = "/models/toranomon.glb",
}: {
  fitHeight?: number;
  url?: string;
}) {
  // GLBがない場合に備え try-catch 的に扱う
  let gltf: any = null;
  try {
    gltf = useGLTF(url);
  } catch (e) {
    gltf = null;
  }

  const ref = useRef<THREE.Group>(null!);

  // boundingBox から高さスケール
  const scale = useMemo(() => {
    if (!gltf?.scene) return 1;
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const h = size.y || 1;
    return fitHeight / h;
  }, [gltf, fitHeight]);

  if (!gltf?.scene) {
    // 代替：細長い箱でプレースホルダ
    return (
      <mesh castShadow receiveShadow scale={[0.2, fitHeight, 0.2]}>
        <boxGeometry />
        <meshStandardMaterial color="#999" metalness={0.1} roughness={0.8} />
      </mesh>
    );
  }

  return <primitive object={gltf.scene} scale={scale} />;
}
useGLTF.preload("/models/toranomon.glb");

/** ===================== 共有シーン（Web/ARの両方から使う） ===================== */

function SharedScene({
  plan,
  towerHeight,
}: {
  plan: ScenePlan;
  towerHeight: number;
}) {
  return (
    <>
      {/* 環境光・直射光 */}
      <ambientLight intensity={0.8} />
      <directionalLight
        position={[3, 4, 2]}
        intensity={1.2}
        castShadow
        shadow-mapSize={1024}
      />
      <Suspense fallback={null}>
        {/* 街の環境に近いHDRI（任意）: dreiのEnvironmentを使う場合は適宜追加 */}
        {/* <Environment preset="city" /> */}
        <group>
          {/* 中央にタワー */}
          <TowerModel fitHeight={towerHeight} />
          {/* タワー周囲の浮遊オブジェクト群 */}
          {plan.objects.map((spec, i) => (
            <FloatingObjects key={i} spec={spec} seed={i * 13 + 7} />
          ))}
        </group>
      </Suspense>
      {/* 床の簡易グリッド（任意） */}
      {/* <gridHelper args={[10, 10]} /> */}
    </>
  );
}

/** ===================== Webビューワ（OrbitControls / スワイプ回転） ===================== */

function WebViewer({ plan }: { plan: ScenePlan }) {
  return (
    <Canvas shadows camera={{ position: [2.5, 1.6, 2.5], fov: 50 }}>
      <SharedScene plan={plan} towerHeight={1.2} />
      <OrbitControls enableDamping dampingFactor={0.05} />
    </Canvas>
  );
}

/** ===================== ARビューワ（Zappar Image Tracker） ===================== */
/** 10cm角マーカーに合わせ、実物1/400模型（高さ266m → 0.665m）を想定。
    -> towerHeight=0.665 に設定。モデルとマーカーの相対位置は実測で補正可。
*/
function ARViewer({ plan }: { plan: ScenePlan }) {
  // マーカーの原点に合わせ、XYがマーカー平面、Z+が上になるよう回転
  return (
    <ZapparCanvas>
      <ZapparCamera makeDefault />
      <Suspense fallback={null}>
        <ImageTracker
          targetImage="/targets/marker.zpt"
          onVisible={() => console.log("marker visible")}
          onNotVisible={() => console.log("marker lost")}
        >
          {/* マーカー面 → 地面になるように90度回転 */}
          <group rotation={[Math.PI / 2, 0, 0]}>
            {/* マーカー“の脇”に置きたい場合は position=[x,y,z] を調整。
                例）模型のベース左前面にマーカーを貼ったなら、
                    タワーのフットプリント中心までのオフセットを実測して反映。 */}
            <SharedScene plan={plan} towerHeight={0.665} />
          </group>
        </ImageTracker>
      </Suspense>
    </ZapparCanvas>
  );
}

/** ===================== UI + ルート ===================== */

export default function App() {
  const [mode, setMode] = useState<"web" | "ar">("web");
  const [prompt, setPrompt] = useState<string>(
    "20 red spheres orbit, 5 gold torus, add 10 blue boxes floating"
  );
  const [plan, setPlan] = useState<ScenePlan>(() =>
    planSceneFromTextMock(prompt)
  );
  const [status, setStatus] = useState<string>("");

  async function applyPrompt() {
    setStatus("Parsing…");
    // 実運用：LLM API 呼び出し
    // const plan = await callYourLLM(prompt)
    const plan = planSceneFromTextMock(prompt);
    // 簡易バリデーション／安全装置
    plan.objects.forEach((o) => {
      o.count = Math.min(Math.max(o.count ?? 1, 1), 200);
      o.size = Math.min(Math.max(o.size ?? 0.06, 0.02), 0.4);
      o.radius = Math.min(Math.max(o.radius ?? 1.2, 0.2), 5);
      o.metalness = Math.min(Math.max(o.metalness ?? 0.2, 0), 1);
      o.roughness = Math.min(Math.max(o.roughness ?? 0.7, 0), 1);
    });
    setPlan(plan);
    setStatus("Done");
    setTimeout(() => setStatus(""), 800);
  }

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#0a0a0a",
      }}
    >
      {/* 上部コントロールバー */}
      <div
        style={{
          position: "absolute",
          zIndex: 10,
          top: 12,
          left: 12,
          right: 12,
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button
          onClick={() => setMode("web")}
          style={{
            padding: "8px 12px",
            borderRadius: 12,
            border: "1px solid #333",
            background: mode === "web" ? "#1f2937" : "#111827",
            color: "#eee",
          }}
        >
          Web
        </button>
        <button
          onClick={() => setMode("ar")}
          style={{
            padding: "8px 12px",
            borderRadius: 12,
            border: "1px solid #333",
            background: mode === "ar" ? "#1f2937" : "#111827",
            color: "#eee",
          }}
        >
          AR
        </button>
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Type: 20 red spheres orbit, 5 gold torus..."
          style={{
            flex: 1,
            minWidth: 200,
            padding: "10px 12px",
            borderRadius: 12,
            border: "1px solid #374151",
            background: "#0b1220",
            color: "#e5e7eb",
            outline: "none",
          }}
        />
        <button
          onClick={applyPrompt}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #374151",
            background: "#2563eb",
            color: "#fff",
            fontWeight: 600,
          }}
        >
          Apply
        </button>
        <span style={{ color: "#9ca3af", marginLeft: 8 }}>{status}</span>
      </div>

      {/* ビューワ本体 */}
      <div style={{ width: "100%", height: "100%" }}>
        {mode === "web" ? <WebViewer plan={plan} /> : <ARViewer plan={plan} />}
      </div>
    </div>
  );
}
