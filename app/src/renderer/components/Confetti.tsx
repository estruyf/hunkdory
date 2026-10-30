import { useEffect, useRef } from 'react';

// The theme's own colours, read from the CSS variables so the confetti follows light and dark.
const COLORS = ['--sb-accent', '--sb-ok', '--sb-link', '--sb-warn', '--sb-profile-purple', '--sb-caution'];
const COUNT = 140;
const GRAVITY = 0.12;
const DRAG = 0.985;

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  w: number;
  h: number;
  color: string;
  flip: number;
}

/** One burst of confetti over the view, from both top corners; skipped when the system asks for reduced motion. */
export function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const style = getComputedStyle(document.documentElement);
    const colors = COLORS.map((v) => style.getPropertyValue(v).trim()).filter(Boolean);
    const width = canvas.clientWidth;
    const pieces: Piece[] = Array.from({ length: COUNT }, (_, i) => {
      const left = i % 2 === 0;
      const speed = 7 + Math.random() * 7;
      // Thrown up and inward, between 50° and 80° from the horizontal.
      const tilt = ((50 + Math.random() * 30) * Math.PI) / 180;
      return {
        x: left ? 0 : width,
        y: canvas.clientHeight * 0.35,
        vx: Math.cos(tilt) * speed * (left ? 1 : -1),
        vy: -Math.sin(tilt) * speed,
        angle: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 4,
        h: 8 + Math.random() * 6,
        color: colors[i % colors.length] ?? '#ffd43b',
        flip: Math.random() * Math.PI * 2,
      };
    });

    let frame = 0;
    const tick = () => {
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      let alive = false;
      for (const p of pieces) {
        p.vx *= DRAG;
        p.vy = p.vy * DRAG + GRAVITY;
        p.x += p.vx;
        p.y += p.vy;
        p.angle += p.spin;
        p.flip += 0.12;
        if (p.y > canvas.clientHeight + 20) continue;
        alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);
        // Squash one side as it turns, so each piece seems to tumble.
        ctx.scale(1, Math.cos(p.flip));
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-50 size-full" aria-hidden="true" />;
}
