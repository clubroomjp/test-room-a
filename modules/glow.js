import { total } from "room:a";

export function describe() {
  return { kind: "shape", name: "glow", uses: ["a"], total };
}

export function draw(ctx, t, width, height) {
  ctx.fillStyle = "#101820";
  ctx.fillRect(0, 0, width, height);
  const r = 30 + 20 * Math.sin(t * 2) + total;
  ctx.fillStyle = `hsl(${Math.floor(t * 60) % 360} 80% 60%)`;
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, r, 0, Math.PI * 2);
  ctx.fill();
}