import { describe, expect, it } from "vitest";
import { buildBedCode, bedProductName } from "./productCodes";
import { detectLaminate, formatProductCode, needsNormalization } from "./laminates";

describe("códigos CAM", () => {
  it("cama lisa: CAM 18", () => {
    const c = buildBedCode({ modelCode: "002", structureCode: "01", measureCode: "140", fabricCode6: "012007", variant: "N" });
    expect(c).toBe("CAM00201140012007N");
  });
  it("Munique 218/03 com L02: 21 caracteres", () => {
    const c = buildBedCode({ modelCode: "218", structureCode: "03", measureCode: "160", fabricCode6: "012020", variant: "N", laminateCode: "L02" });
    expect(c).toBe("CAM21803160012020NL02");
    expect(c).toHaveLength(21);
  });
  it("PERCAM com laminado: 24 caracteres", () => {
    const c = buildBedCode({ modelCode: "218", structureCode: "03", measureCode: "160", fabricCode6: "012020", variant: "N", laminateCode: "L02", personalized: true });
    expect(c).toHaveLength(24);
    expect(c.startsWith("PERCAM")).toBe(true);
  });
  it("recusa os números retirados", () => {
    for (const m of ["111", "117", "118", "122", "125", "129", "132", "135"]) {
      expect(buildBedCode({ modelCode: m, structureCode: "02", measureCode: "160", fabricCode6: "012007", variant: "N" })).toBe("");
    }
  });
  it("recusa estrutura 04", () => {
    expect(buildBedCode({ modelCode: "300", structureCode: "04", measureCode: "160", fabricCode6: "012007", variant: "N" })).toBe("");
  });
  it("sem os 6 dígitos do tecido não gera código", () => {
    expect(buildBedCode({ modelCode: "002", structureCode: "01", measureCode: "140", refTec: "TEC000027", variant: "N" })).toBe("");
  });
});

describe("laminado no nome", () => {
  it("Ouro Rose → L03", () => expect(detectLaminate("Cama Kali 160x200 Laminado Ouro Rose")).toBe("L03"));
  it("Prateado → L02", () => expect(detectLaminate("laminado prateado")).toBe("L02"));
  it("fita dourada → L01", () => expect(detectLaminate("cama com fita dourada")).toBe("L01"));
  it("Laminado Espelho → L05", () => expect(detectLaminate("Laminado Espelho")).toBe("L05"));
  it("nome canónico usa Prata a seguir ao tecido", () => {
    expect(bedProductName({ modelName: "Munique", structureName: "Alongada", measureName: "200x160", fabricLabel: "Bass Taupe", laminateCode: "L02" }))
      .toBe("Cama Munique Alongada 200x160cm - Bass Taupe - Laminado Prata");
  });
});

describe("etiquetas e normalização", () => {
  it("segmenta CAM 21", () => expect(formatProductCode("CAM21803160012020NL02")).toBe("CAM 218 03 160 012020 N L02"));
  it("segmenta CAM 18", () => expect(formatProductCode("CAM00201140012007N")).toBe("CAM 002 01 140 012007 N"));
  it("EAN-13 fica por normalizar", () => expect(needsNormalization("2015437579508")).toBe(true));
  it("CAM 21 não precisa de normalizar", () => expect(needsNormalization("CAM21803160012020NL02")).toBe(false));
});
