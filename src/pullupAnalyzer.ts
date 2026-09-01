import { angle, distance, midpoint, type Point } from './poseMath';

export type PullupPhase = 'SEARCHING' | 'BOTTOM' | 'PULLING' | 'TOP' | 'LOWERING';

export type PullupAnalysis = {
  phase: PullupPhase;
  repCount: number;
  leftElbow: number;
  rightElbow: number;
  avgElbow: number;
  bodySwing: number;
  score: number;
  feedback: string[];
  goodRepFlash: boolean;
};

type Landmark = Point;

const IDX = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

export class PullupAnalyzer {
  private phase: PullupPhase = 'SEARCHING';
  private reps = 0;
  private prevHipCenter: Point | null = null;
  private smoothedSwing = 0;
  private lastRepAt = 0;
  private bottomSeenAt = 0;
  private topSeenAt = 0;

  reset() {
    this.phase = 'SEARCHING';
    this.reps = 0;
    this.prevHipCenter = null;
    this.smoothedSwing = 0;
    this.lastRepAt = 0;
    this.bottomSeenAt = 0;
    this.topSeenAt = 0;
  }

  analyze(lm: Landmark[], now = performance.now()): PullupAnalysis {
    const ls = lm[IDX.leftShoulder];
    const rs = lm[IDX.rightShoulder];
    const le = lm[IDX.leftElbow];
    const re = lm[IDX.rightElbow];
    const lw = lm[IDX.leftWrist];
    const rw = lm[IDX.rightWrist];
    const lh = lm[IDX.leftHip];
    const rh = lm[IDX.rightHip];
    const nose = lm[IDX.nose];

    const required = [ls, rs, le, re, lw, rw, lh, rh, nose];
    const visible = required.every((p) => (p?.visibility ?? 1) > 0.45);
    if (!visible) return this.output(0, 0, 0, ['請讓肩膀、手肘、手腕、髖部都進入畫面'], false);

    const leftElbow = angle(ls, le, lw);
    const rightElbow = angle(rs, re, rw);
    const avgElbow = (leftElbow + rightElbow) / 2;
    const shoulderCenter = midpoint(ls, rs);
    const hipCenter = midpoint(lh, rh);

    let swing = 0;
    if (this.prevHipCenter) {
      const shoulderWidth = Math.max(distance(ls, rs), 0.05);
      swing = (Math.abs(hipCenter.x - this.prevHipCenter.x) / shoulderWidth) * 100;
    }
    this.prevHipCenter = hipCenter;
    this.smoothedSwing = this.smoothedSwing * 0.9 + swing * 0.1;

    const wristsY = (lw.y + rw.y) / 2;
    const shouldersY = shoulderCenter.y;
    const isBottom = avgElbow >= 155;
    const isFlexed = avgElbow <= 95;
    const headNearBar = nose.y <= wristsY + 0.12;
    const shouldersLifted = shouldersY <= wristsY + 0.30;
    const isTop = isFlexed && headNearBar && shouldersLifted;

    let goodRepFlash = false;

    switch (this.phase) {
      case 'SEARCHING':
        if (isBottom) {
          this.phase = 'BOTTOM';
          this.bottomSeenAt = now;
        }
        break;
      case 'BOTTOM':
        if (avgElbow < 145) this.phase = 'PULLING';
        break;
      case 'PULLING':
        if (isTop) {
          this.phase = 'TOP';
          this.topSeenAt = now;
        } else if (isBottom && now - this.bottomSeenAt > 250) {
          this.phase = 'BOTTOM';
        }
        break;
      case 'TOP':
        if (avgElbow > 110) this.phase = 'LOWERING';
        break;
      case 'LOWERING':
        if (isBottom) {
          if (now - this.lastRepAt > 600 && now - this.topSeenAt > 200) {
            this.reps += 1;
            this.lastRepAt = now;
            goodRepFlash = true;
          }
          this.phase = 'BOTTOM';
          this.bottomSeenAt = now;
        } else if (isTop) {
          this.phase = 'TOP';
        }
        break;
    }

    const feedback: string[] = [];
    if (Math.abs(leftElbow - rightElbow) > 18) feedback.push('左右手臂不同步');
    if (this.smoothedSwing > 2.2) feedback.push('身體擺盪偏大');
    if (this.phase === 'BOTTOM' && avgElbow < 160) feedback.push('底部手臂可再伸直');
    if (feedback.length === 0) feedback.push('動作穩定');

    let score = 100;
    score -= Math.min(25, Math.abs(leftElbow - rightElbow) * 0.7);
    score -= Math.min(30, this.smoothedSwing * 6);
    score = Math.max(0, Math.round(score));

    return this.output(leftElbow, rightElbow, avgElbow, feedback, goodRepFlash, score);
  }

  private output(leftElbow: number, rightElbow: number, avgElbow: number, feedback: string[], goodRepFlash: boolean, score = 0): PullupAnalysis {
    return {
      phase: this.phase,
      repCount: this.reps,
      leftElbow: Math.round(leftElbow),
      rightElbow: Math.round(rightElbow),
      avgElbow: Math.round(avgElbow),
      bodySwing: Number(this.smoothedSwing.toFixed(1)),
      score,
      feedback,
      goodRepFlash,
    };
  }
}
