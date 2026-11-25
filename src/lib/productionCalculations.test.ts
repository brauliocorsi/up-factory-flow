import { describe, expect, it } from "vitest";
import {
  calculateCapacity,
  loadSummary,
  hoursLabel,
  usefulMinutes,
} from "./productionCalculations";

describe("capacidade de produção", () => {
  it("desconta pausas uma vez por dia e multiplica pelos dias úteis", () => {
    expect(usefulMinutes(8, 30, 5)).toBe(2250);
    expect(usefulMinutes(7.5, 0, 1)).toBe(450);
    expect(usefulMinutes(1, 90, 1)).toBeNull();
    expect(usefulMinutes(0, 0, 0)).toBeNull();
    expect(usefulMinutes(7.5, 0, 1.5)).toBeNull();
  });
  it("não declara viável uma carga com tempos desconhecidos", () => {
    expect(loadSummary(60, 450, true).state).toBe("unknown");
    expect(loadSummary(60, 450, false).state).toBe("available");
  });
  it("distingue ausência de equipa de excesso de carga", () => {
    expect(loadSummary(60, 0).percent).toBeNull();
    expect(loadSummary(60, 0).state).toBe("no_team");
    expect(loadSummary(480, 450).balance).toBe(-30);
    expect(loadSummary(480, 450).state).toBe("over");
  });
  it("converte a jornada de 450 minutos em horas", () => {
    expect(hoursLabel(450)).toBe("7h30");
  });
  it("calcula horas disponíveis × tempo por produto em unidades inteiras", () => {
    const result = calculateCapacity(
      [{ stage: "corte", minutesPerUnit: 60 }],
      [{ id: "ana", stage: "corte", minutes: 450 }],
      8,
    );
    expect(result.units).toBe(7);
    expect(result.needed).toBe(480);
    expect(result.rows[0]?.balance).toBe(-30);
  });
  it("a etapa limitante define a capacidade do conjunto", () => {
    const result = calculateCapacity(
      [
        { stage: "corte", minutesPerUnit: 30 },
        { stage: "costura", minutesPerUnit: 90 },
      ],
      [
        { id: "ana", stage: "corte", minutes: 450 },
        { id: "rui", stage: "costura", minutes: 450 },
      ],
      6,
    );
    expect(result.units).toBe(5);
    expect(result.needed).toBe(720);
  });
  it("tempo em falta não conta como zero", () => {
    const result = calculateCapacity(
      [{ stage: "corte", minutesPerUnit: null }],
      [{ id: "ana", stage: "corte", minutes: 450 }],
      1,
    );
    expect(result.complete).toBe(false);
    expect(result.units).toBeNull();
    expect(result.needed).toBeNull();
  });
  it("recusa dupla contagem do mesmo colaborador", () => {
    const result = calculateCapacity(
      [
        { stage: "corte", minutesPerUnit: 30 },
        { stage: "costura", minutesPerUnit: 60 },
      ],
      [
        { id: "ana", stage: "corte", minutes: 450 },
        { id: "ana", stage: "costura", minutes: 450 },
      ],
      1,
    );
    expect(result.duplicatePeople).toBe(true);
    expect(result.units).toBeNull();
  });
  it("recusa valores negativos e quantidades fracionárias", () => {
    expect(calculateCapacity([{ stage: "corte", minutesPerUnit: 0 }], [], 1).invalid).toBe(true);
    expect(calculateCapacity([], [{ id: "a", stage: "corte", minutes: -1 }], 1).invalid).toBe(true);
    expect(calculateCapacity([], [], 1.5).invalid).toBe(true);
  });
});
