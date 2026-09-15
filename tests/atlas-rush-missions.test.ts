import { describe, expect, it } from 'vitest';

import { createBlitzRun, getBlitzScoreBreakdown, stepBlitzRun } from '../shared/atlas/blitz/core';
import { selectBlitzMissions } from '../shared/atlas/blitz/missions';
import type { BlitzInput, BlitzRunState } from '../shared/atlas/blitz/types';

const idle: BlitzInput = { steer: 0, drift: false, boost: false, brake: false };

function advance(state: BlitzRunState, ticks: number, input: BlitzInput = idle): BlitzRunState {
  let current = state;
  for (let tick = 0; tick < ticks; tick += 1) current = stepBlitzRun(current, input);
  return current;
}

describe('NIM RUSH physical mission contracts', () => {
  it('selects one line, one control, and one risk contract from a seed', () => {
    const missions = selectBlitzMissions('daily-contract-seed');
    expect(missions).toHaveLength(3);
    expect(missions.map((mission) => mission.kind).sort()).toEqual(['control', 'line', 'risk']);
    expect(missions).toEqual(selectBlitzMissions('daily-contract-seed'));
    expect(missions).not.toEqual(selectBlitzMissions('different-seed'));
    expect(missions.every((mission) => mission.description.length <= 120)).toBe(true);
    expect(missions.every((mission) => mission.bonus > 0)).toBe(true);
  });

  it('uses deterministic rulesets with different hazard pressure', () => {
    const rookie = createBlitzRun({ cityId: 'lagos', seed: 'rules', difficulty: 'rookie' });
    const pro = createBlitzRun({ cityId: 'lagos', seed: 'rules', difficulty: 'pro' });
    expect(rookie.difficulty).toBe('rookie');
    expect(pro.difficulty).toBe('pro');
    expect(pro.missions.map((mission) => mission.id)).toEqual(rookie.missions.map((mission) => mission.id));
    expect(pro.rulesetVersion).not.toBe(rookie.rulesetVersion);
  });

  it('keeps missions in the run and exposes progress without a blocking question', () => {
    let state = advance(createBlitzRun({ cityId: 'lagos', seed: 'hud-contract' }), 30 * 3 + 2);
    expect(state.missions.every((mission) => mission.status === 'pending' || mission.status === 'active')).toBe(true);
    while (state.distanceMeters < state.missions[0]!.gateDistance) state = stepBlitzRun(state, idle);
    expect(state.missions.some((mission) => mission.status === 'active')).toBe(true);
    expect(state.missions.every((mission) => typeof mission.progress === 'number' && mission.target > 0)).toBe(true);
    expect(state.activeMission).not.toBeNull();
  });

  it('records the physical score categories and keeps their total authoritative', () => {
    let state = advance(createBlitzRun({ cityId: 'lagos', seed: 'score-contract' }), 30 * 3 + 2);
    for (let tick = 0; tick < 30 * 90 && state.phase === 'running'; tick += 1) {
      state = stepBlitzRun(state, { steer: tick % 120 < 18 ? 0.45 : 0, drift: tick % 120 < 18, boost: tick % 180 < 24, brake: false });
    }
    const breakdown = getBlitzScoreBreakdown(state);
    expect(breakdown).toMatchObject({
      finishTime: expect.any(Number),
      racingLine: expect.any(Number),
      control: expect.any(Number),
      airtime: expect.any(Number),
      missions: expect.any(Number),
      drift: expect.any(Number),
      collisionPenalties: expect.any(Number),
      missedGatePenalties: expect.any(Number),
    });
    expect(breakdown.total).toBe(state.score);
    expect(state.penaltyScore).toBe(breakdown.collisionPenalties + breakdown.missedGatePenalties);
  });
});
