/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Ship, Package, Map as MapIcon, Play, RefreshCw, Anchor } from 'lucide-react';

// --- Constants ---
const COLORS = {
  ocean: '#E3F2FD',
  oceanDeep: '#BBDEFB',
  boat: '#FFAB91',
  island: '#C8E6C9',
  islandBeach: '#FFF9C4',
  rock: '#CFD8DC',
  text: '#455A64',
  accent: '#80CBC4',
  package: '#FFE082',
};

const BOAT_SPEED = 0.8;
const BOAT_ROTATION_SPEED = 0.025;
const FRICTION = 0.94;
const BOAT_RADIUS = 10;
const WORLD_SIZE = 3000;
const DELIVERY_PROXIMITY = 80; // Distance to trigger delivery

type GameState = 'MENU' | 'PLAYING' | 'DELIVERED' | 'CRASHED';

interface Point {
  x: number;
  y: number;
}

interface Island extends Point {
  id: number;
  radius: number;
  hasPackage: boolean;
  isTarget: boolean;
}

interface Rock extends Point {
  radius: number;
}

interface WakePoint extends Point {
  angle: number;
  life: number; // 0 to 1
}

export default function App() {
  const [gameState, setGameState] = useState<GameState>('MENU');
  const [score, setScore] = useState(0);
  const [isAudioStarted, setIsAudioStarted] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  
  // Game Entities
  const boatRef = useRef({
    x: WORLD_SIZE / 2,
    y: WORLD_SIZE / 2,
    angle: -Math.PI / 2,
    vx: 0,
    vy: 0,
  });

  const cameraRef = useRef({
    x: 0,
    y: 0,
  });

  const wakeRef = useRef<WakePoint[]>([]);
  const keys = useRef<{ [key: string]: boolean }>({});
  const islands = useRef<Island[]>([]);
  const rocks = useRef<Rock[]>([]);
  const targetIslandId = useRef<number | null>(null);

  // Helper to check distance between two points
  const getDist = (p1: Point, p2: Point) => Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);

  // Audio Setup (unchanged logic, just ensuring it's here)
  const startAudio = () => {
    if (isAudioStarted) return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    audioCtxRef.current = ctx;
    const bufferSize = 2 * ctx.sampleRate;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) output[i] = Math.random() * 2 - 1;
    const whiteNoise = ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.1;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0.05;
    whiteNoise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    whiteNoise.start();
    lfo.start();
    const playNote = (freq: number, time: number) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(0.02, time + 2);
      g.gain.linearRampToValueAtTime(0, time + 6);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + 7);
    };
    const notes = [261.63, 329.63, 392.00, 440.00, 523.25];
    setInterval(() => {
      const note = notes[Math.floor(Math.random() * notes.length)];
      if (audioCtxRef.current) playNote(note, audioCtxRef.current.currentTime + Math.random() * 2);
    }, 4000);
    setIsAudioStarted(true);
  };

  // Initialize Game World
  const initWorld = useCallback(() => {
    boatRef.current = {
      x: WORLD_SIZE / 2,
      y: WORLD_SIZE / 2,
      angle: -Math.PI / 2,
      vx: 0,
      vy: 0,
    };
    wakeRef.current = [];

    // Generate Islands in large world
    const newIslands: Island[] = [];
    let attempts = 0;
    while (newIslands.length < 12 && attempts < 500) {
      const radius = Math.random() * 30 + 50;
      const island: Island = {
        id: newIslands.length,
        x: Math.random() * (WORLD_SIZE - 400) + 200,
        y: Math.random() * (WORLD_SIZE - 400) + 200,
        radius,
        hasPackage: false,
        isTarget: false,
      };
      const isTooClose = newIslands.some(other => getDist(island, other) < (island.radius + other.radius + 250));
      const isTooCloseToBoat = getDist(island, boatRef.current) < 300;
      if (!isTooClose && !isTooCloseToBoat) newIslands.push(island);
      attempts++;
    }
    if (newIslands.length > 0) {
      const targetIdx = Math.floor(Math.random() * newIslands.length);
      newIslands[targetIdx].isTarget = true;
      targetIslandId.current = newIslands[targetIdx].id;
    }
    islands.current = newIslands;

    // Generate Rocks
    const newRocks: Rock[] = [];
    attempts = 0;
    while (newRocks.length < 15 && attempts < 200) {
      const rock: Rock = {
        x: Math.random() * WORLD_SIZE,
        y: Math.random() * WORLD_SIZE,
        radius: Math.random() * 15 + 20,
      };
      const onIsland = islands.current.some(island => getDist(rock, island) < (rock.radius + island.radius + 60));
      const onBoat = getDist(rock, boatRef.current) < 200;
      if (!onIsland && !onBoat) newRocks.push(rock);
      attempts++;
    }
    rocks.current = newRocks;
  }, []);

  const startGame = () => {
    startAudio();
    initWorld();
    setGameState('PLAYING');
    setScore(0);
  };

  // Game Loop
  useEffect(() => {
    if (gameState !== 'PLAYING') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const update = () => {
      const boat = boatRef.current;

      // Controls using e.code for layout independence
      if (keys.current['KeyW'] || keys.current['ArrowUp']) {
        boat.vx += Math.cos(boat.angle) * BOAT_SPEED * 0.1;
        boat.vy += Math.sin(boat.angle) * BOAT_SPEED * 0.1;
      }
      if (keys.current['KeyA'] || keys.current['ArrowLeft']) boat.angle -= BOAT_ROTATION_SPEED;
      if (keys.current['KeyD'] || keys.current['ArrowRight']) boat.angle += BOAT_ROTATION_SPEED;
      if (keys.current['KeyS'] || keys.current['ArrowDown']) {
        boat.vx -= Math.cos(boat.angle) * BOAT_SPEED * 0.05;
        boat.vy -= Math.sin(boat.angle) * BOAT_SPEED * 0.05;
      }

      // Physics
      boat.x += boat.vx;
      boat.y += boat.vy;
      boat.vx *= FRICTION;
      boat.vy *= FRICTION;

      // World Bounds
      boat.x = Math.max(0, Math.min(WORLD_SIZE, boat.x));
      boat.y = Math.max(0, Math.min(WORLD_SIZE, boat.y));

      // Camera Follow
      cameraRef.current.x = boat.x - canvas.width / 2;
      cameraRef.current.y = boat.y - canvas.height / 2;
      // Clamp camera
      cameraRef.current.x = Math.max(0, Math.min(WORLD_SIZE - canvas.width, cameraRef.current.x));
      cameraRef.current.y = Math.max(0, Math.min(WORLD_SIZE - canvas.height, cameraRef.current.y));

      // Wake Logic
      if (Math.abs(boat.vx) + Math.abs(boat.vy) > 0.1) {
        wakeRef.current.unshift({ x: boat.x, y: boat.y, angle: boat.angle, life: 1.0 });
      }
      wakeRef.current.forEach(p => {
        p.life -= 0.01;
        p.x += Math.cos(p.angle + Math.PI) * 0.2;
        p.y += Math.sin(p.angle + Math.PI) * 0.2;
      });
      wakeRef.current = wakeRef.current.filter(p => p.life > 0).slice(0, 100);

      // Collisions with Rocks
      for (const rock of rocks.current) {
        if (getDist(boat, rock) < rock.radius + 8) setGameState('CRASHED');
      }

      // Collisions/Proximity with Islands
      for (const island of islands.current) {
        const dist = getDist(boat, island);
        const minDist = island.radius + BOAT_RADIUS;
        
        if (dist < minDist) {
          const angle = Math.atan2(boat.y - island.y, boat.x - island.x);
          boat.x = island.x + Math.cos(angle) * minDist;
          boat.y = island.y + Math.sin(angle) * minDist;
          boat.vx *= 0.5;
          boat.vy *= 0.5;
        }

        if (island.isTarget && dist < island.radius + DELIVERY_PROXIMITY) {
          playSuccessSound();
          setScore(s => s + 1);
          island.isTarget = false;
          let nextTargetIdx;
          do {
            nextTargetIdx = Math.floor(Math.random() * islands.current.length);
          } while (islands.current[nextTargetIdx].id === island.id);
          islands.current[nextTargetIdx].isTarget = true;
          targetIslandId.current = islands.current[nextTargetIdx].id;
        }
      }
    };

    const playSuccessSound = () => {
      if (!audioCtxRef.current) return;
      const ctx = audioCtxRef.current;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.1); // E5
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const cam = cameraRef.current;

      ctx.save();
      ctx.translate(-cam.x, -cam.y);

      // Draw Grid
      ctx.strokeStyle = COLORS.oceanDeep;
      ctx.lineWidth = 1;
      const gridSize = 200;
      for (let x = 0; x <= WORLD_SIZE; x += gridSize) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_SIZE); ctx.stroke();
      }
      for (let y = 0; y <= WORLD_SIZE; y += gridSize) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_SIZE, y); ctx.stroke();
      }

      // Draw Wake
      if (wakeRef.current.length > 1) {
        ctx.lineWidth = 4;
        for (let i = 0; i < wakeRef.current.length - 1; i++) {
          const p1 = wakeRef.current[i];
          const p2 = wakeRef.current[i+1];
          ctx.strokeStyle = `rgba(255, 255, 255, ${p1.life * 0.4})`;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }

      // Draw Rocks
      rocks.current.forEach(rock => {
        ctx.fillStyle = COLORS.rock;
        ctx.beginPath(); ctx.arc(rock.x, rock.y, rock.radius, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.stroke();
      });

      // Draw Islands
      islands.current.forEach(island => {
        ctx.fillStyle = COLORS.islandBeach;
        ctx.beginPath(); ctx.arc(island.x, island.y, island.radius + 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = COLORS.island;
        ctx.beginPath(); ctx.arc(island.x, island.y, island.radius, 0, Math.PI * 2); ctx.fill();

        if (island.isTarget) {
          const time = Date.now() * 0.001;
          ctx.strokeStyle = COLORS.accent;
          ctx.lineWidth = 3;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.arc(island.x, island.y, island.radius + 20 + Math.sin(time * 5) * 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = COLORS.text;
          ctx.font = 'bold 24px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('📍', island.x, island.y - island.radius - 25);
        }
      });

      // Draw Boat
      const boat = boatRef.current;
      ctx.save();
      ctx.translate(boat.x, boat.y);
      ctx.rotate(boat.angle);
      ctx.fillStyle = COLORS.boat;
      ctx.beginPath(); ctx.moveTo(15, 0); ctx.lineTo(-10, 10); ctx.lineTo(-10, -10); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.stroke();
      ctx.restore();

      ctx.restore();

      // Draw Directional Arrow (UI Layer)
      const targetIsland = islands.current.find(i => i.id === targetIslandId.current);
      if (targetIsland) {
        const dx = targetIsland.x - boat.x;
        const dy = targetIsland.y - boat.y;
        const angleToTarget = Math.atan2(dy, dx);
        
        ctx.save();
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(angleToTarget);
        ctx.translate(60, 0); // Offset from center
        
        ctx.fillStyle = COLORS.accent;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-5, 7);
        ctx.lineTo(-5, -7);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      animationFrameId = requestAnimationFrame(() => { update(); draw(); });
    };

    const resize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    window.addEventListener('resize', resize);
    resize(); draw();

    const handleKeyDown = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const handleKeyUp = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', resize);
    };
  }, [gameState]);

  return (
    <div className="relative w-full h-screen overflow-hidden font-sans" style={{ backgroundColor: COLORS.ocean }}>
      {/* Game Canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 block cursor-none"
        id="game-canvas"
      />

      {/* Overlay UI */}
      <AnimatePresence>
        {gameState === 'MENU' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex flex-col items-center justify-center bg-white/40 backdrop-blur-sm z-50"
            id="menu-overlay"
          >
            <motion.div
              initial={{ y: 20 }}
              animate={{ y: 0 }}
              className="text-center p-12 bg-white/80 rounded-3xl shadow-2xl border border-white/50"
            >
              <div className="flex justify-center mb-6">
                <div className="p-4 bg-teal-50 rounded-full">
                  <Ship className="w-16 h-16 text-teal-600" />
                </div>
              </div>
              <h1 className="text-5xl font-bold text-slate-700 mb-2 tracking-tight">Тихая Доставка</h1>
              <p className="text-slate-500 mb-10 italic">Спокойные волны, тихие острова, бережные посылки.</p>
              
              <button
                onClick={startGame}
                className="group relative flex items-center gap-3 px-10 py-4 bg-teal-500 hover:bg-teal-600 text-white rounded-full text-xl font-semibold transition-all shadow-lg hover:shadow-teal-200 hover:-translate-y-1 active:translate-y-0"
                id="start-button"
              >
                <Play className="w-6 h-6 fill-current" />
                Начать путь
              </button>
            </motion.div>
          </motion.div>
        )}

        {gameState === 'PLAYING' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute top-8 left-8 right-8 flex justify-between items-start pointer-events-none z-40"
            id="hud"
          >
            <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-white/50 flex items-center gap-4">
              <div className="w-10 h-10 bg-teal-100 rounded-lg flex items-center justify-center">
                <Package className="text-teal-600 w-6 h-6" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Доставки</p>
                <p className="text-2xl font-mono font-bold text-slate-700">{score}</p>
              </div>
            </div>

            <div className="bg-white/80 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-white/50 flex items-center gap-4">
              <div className="text-right">
                <p className="text-xs uppercase tracking-widest text-slate-400 font-bold">Навигация</p>
                <p className="text-sm text-slate-600">WASD или Стрелки для управления</p>
              </div>
              <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center">
                <Anchor className="text-slate-600 w-6 h-6" />
              </div>
            </div>
          </motion.div>
        )}

        {gameState === 'CRASHED' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center bg-red-50/30 backdrop-blur-md z-50"
            id="crash-overlay"
          >
            <div className="text-center p-10 bg-white rounded-3xl shadow-2xl border border-red-100 max-w-sm">
              <h2 className="text-3xl font-bold text-slate-800 mb-4">Камни были слишком близко...</h2>
              <p className="text-slate-500 mb-8">Даже в самом спокойном море бывают трудности.</p>
              <button
                onClick={startGame}
                className="flex items-center gap-2 mx-auto px-8 py-3 bg-slate-800 text-white rounded-full hover:bg-slate-900 transition-all shadow-lg"
                id="retry-button"
              >
                <RefreshCw className="w-5 h-5" />
                Попробовать снова
              </button>
              <button
                onClick={() => setGameState('MENU')}
                className="mt-4 text-slate-400 hover:text-slate-600 transition-colors"
                id="back-to-menu"
              >
                В меню
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ambient Ocean Sound Hint (Visual) */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-[0.2em] text-slate-400 opacity-50 pointer-events-none">
        Спокойная Навигация • Тихая Доставка
      </div>
    </div>
  );
}
