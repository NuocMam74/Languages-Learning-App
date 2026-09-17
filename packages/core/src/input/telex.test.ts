import { describe, expect, it } from "vitest";
import { applyDiacritic, applyTelexKey, describeDiacritics, telexInput, telexToVietnamese } from "./telex.ts";

/** Clavier vietnamien intégré (spec §8.4) : Telex, VNI, barre de diacritiques. */

const nfc = (s: string) => s.normalize("NFC");

describe("Telex — voyelles modifiées", () => {
  const cases: [string, string][] = [
    ["aa", "â"],
    ["ee", "ê"],
    ["oo", "ô"],
    ["aw", "ă"],
    ["ow", "ơ"],
    ["uw", "ư"],
    ["w", "ư"],
    ["dd", "đ"],
    ["uow", "ươ"],
    ["dduowngf", "đường"],
    ["tieengs", "tiếng"],
    ["Vieejt Nam", "Việt Nam"],
    ["nguwowif", "người"],
    ["khoer", "khỏe"],
    ["hoaf", "hòa"],
    ["hoafn", "hoàn"],
    ["camr own", "cảm ơn"],
    ["Ddaay laf mas tooi", "Đây là má tôi"],
  ];
  for (const [typed, expected] of cases) {
    it(`${typed} → ${expected}`, () => {
      expect(telexToVietnamese(typed)).toBe(nfc(expected));
    });
  }

  it("sortie toujours en NFC", () => {
    const out = telexToVietnamese("dduowngf");
    expect(out).toBe(out.normalize("NFC"));
    expect([...out]).toHaveLength(5);
  });

  it("majuscules conservées", () => {
    expect(telexToVietnamese("DDoongf")).toBe(nfc("Đồng"));
    expect(telexToVietnamese("W")).toBe("Ư");
  });
});

describe("Telex — compatibilité avec l'implémentation du studio", () => {
  // Table reprise telle quelle d'apps/web/src/studio/studio.test.ts : ce module en est la référence,
  // les deux doivent rester d'accord.
  const cases: [string, string][] = [
    ["tieengs vieetj", "tiếng việt"],
    ["tieesng", "tiếng"],
    ["hoafn", "hoàn"],
    ["dduwowcj", "được"],
    ["nguwowif", "người"],
    ["hoaf", "hòa"],
    ["khoer", "khỏe"],
    ["toans", "toán"],
    ["quas", "quá"],
    ["gif", "gì"],
    ["giaf", "già"],
    ["chaof anh", "chào anh"],
    ["Vieetj Nam", "Việt Nam"],
    ["ddaau", "đâu"],
    ["mawcj", "mặc"],
    ["w", "ư"],
    ["ass", "as"],
    ["aaa", "aa"],
    ["mas", "má"],
    ["mafz", "ma"],
    ["masf", "mà"],
  ];
  for (const [typed, expected] of cases) {
    it(`${typed} → ${expected}`, () => {
      expect(telexToVietnamese(typed)).toBe(nfc(expected));
    });
  }

  it("une lettre sans commande n'est pas transformée", () => {
    expect(applyTelexKey("b", "a")).toBeNull();
    expect(applyTelexKey("", "s")).toBeNull();
  });

  it("saisie en direct : mêmes positions de curseur", () => {
    expect(telexInput("Đây là ba", "Đây là bas", 10)).toEqual({ value: nfc("Đây là bá"), caret: 9 });
    expect(telexInput("ma anh", "mas anh", 3)).toEqual({ value: nfc("má anh"), caret: 2 });
    expect(telexInput("ma", "ma anh", 6)).toBeNull();
  });
});

describe("Telex — tons", () => {
  it("les cinq touches de ton", () => {
    expect(telexToVietnamese("mas")).toBe(nfc("má"));
    expect(telexToVietnamese("maf")).toBe(nfc("mà"));
    expect(telexToVietnamese("mar")).toBe(nfc("mả"));
    expect(telexToVietnamese("max")).toBe(nfc("mã"));
    expect(telexToVietnamese("maj")).toBe(nfc("mạ"));
  });

  it("z retire le ton, et ne fait rien s'il n'y en a pas", () => {
    expect(telexToVietnamese("masz")).toBe("ma");
    expect(applyTelexKey("ma", "z")).toBeNull();
  });

  it("le ton se replace quand le mot s'allonge", () => {
    // « hòa » puis n : le ton passe sur le a (syllabe fermée).
    expect(telexToVietnamese("hoaf")).toBe(nfc("hòa"));
    expect(telexToVietnamese("hoafn")).toBe(nfc("hoàn"));
    // « qu » et « gi » : le u et le i appartiennent à la consonne.
    expect(telexToVietnamese("quas")).toBe(nfc("quá"));
    expect(telexToVietnamese("gias")).toBe(nfc("giá"));
  });

  it("aucune voyelle : la touche reste une lettre", () => {
    expect(applyTelexKey("th", "s")).toBeNull();
    expect(telexToVietnamese("ths")).toBe("ths");
  });
});

describe("Telex — annulation par double frappe", () => {
  it("touche de ton doublée : ton annulé, la lettre est écrite", () => {
    expect(telexToVietnamese("ass")).toBe("as");
    expect(telexToVietnamese("mass")).toBe("mas");
    // Une autre touche de ton remplace simplement le ton posé.
    expect(telexToVietnamese("masf")).toBe(nfc("mà"));
  });

  it("voyelle modifiée doublée : marque annulée, la lettre est écrite", () => {
    expect(telexToVietnamese("aaa")).toBe("aa");
    expect(telexToVietnamese("aww")).toBe("aw");
    expect(telexToVietnamese("ddd")).toBe("dd");
  });
});

describe("VNI", () => {
  const cases: [string, string][] = [
    ["ma1", "má"],
    ["ma2", "mà"],
    ["ma3", "mả"],
    ["ma4", "mã"],
    ["ma5", "mạ"],
    ["a6", "â"],
    ["e6", "ê"],
    ["o6", "ô"],
    ["a8", "ă"],
    ["o7", "ơ"],
    ["u7", "ư"],
    ["d9", "đ"],
    ["d9u7o7ng2", "đường"],
    ["uo7ng2", "ường"],
    ["tie6ng1", "tiếng"],
    ["Vie6t5 Nam", "Việt Nam"],
  ];
  for (const [typed, expected] of cases) {
    it(`${typed} → ${expected}`, () => {
      expect(telexToVietnamese(typed, "vni")).toBe(nfc(expected));
    });
  }

  it("0 retire le ton", () => {
    expect(telexToVietnamese("ma10", "vni")).toBe("ma");
  });

  it("touche doublée : annulation, le chiffre est écrit", () => {
    expect(telexToVietnamese("ma11", "vni")).toBe("ma1");
    expect(telexToVietnamese("a66", "vni")).toBe("a6");
  });

  it("en Telex les chiffres restent des chiffres, en VNI les lettres restent des lettres", () => {
    expect(telexToVietnamese("ma1")).toBe("ma1");
    expect(telexToVietnamese("mas", "vni")).toBe("mas");
  });
});

describe("telexInput (saisie en direct)", () => {
  it("convertit à la frappe et replace le curseur", () => {
    expect(telexInput("ma", "mas", 3)).toEqual({ value: nfc("má"), caret: 2 });
    expect(telexInput("Chào a", "Chào an", 7)).toBeNull();
  });

  it("convertit au milieu d'un texte, le reste est conservé", () => {
    const result = telexInput("ma tôi", "mas tôi", 3);
    expect(result).toEqual({ value: nfc("má tôi"), caret: 2 });
  });

  it("ignore une frappe qui n'est pas une insertion simple", () => {
    expect(telexInput("ma", "ma", 2)).toBeNull();
    expect(telexInput("ma", "maso", 4)).toBeNull();
    expect(telexInput("ma", "ma ", 3)).toBeNull();
  });

  it("le mot courant s'arrête à l'espace", () => {
    expect(telexInput("xin chao", "xin chaos", 9)).toEqual({ value: nfc("xin cháo"), caret: 8 });
  });

  it("VNI : les chiffres sont des touches", () => {
    expect(telexInput("ma", "ma1", 3, "vni")).toEqual({ value: nfc("má"), caret: 2 });
    expect(telexInput("ma", "ma1", 3)).toBeNull();
  });
});

describe("describeDiacritics (barre tactile)", () => {
  it("décrit toutes les touches avec leurs équivalents clavier", () => {
    const bar = describeDiacritics();
    expect(bar).toHaveLength(13);
    expect(bar.map((k) => k.id)).toContain("tone_nang");
    const horn = bar.find((k) => k.id === "horn_o")!;
    expect(horn).toMatchObject({ label: "ơ", kind: "vowel", telex: "w", vni: "7" });
    const sac = bar.find((k) => k.id === "tone_sac")!;
    expect(sac).toMatchObject({ kind: "tone", tone: "sac", telex: "s", vni: "1" });
    // Sans mot en cours, aucune touche n'a d'aperçu.
    expect(bar.every((k) => k.preview === null)).toBe(true);
  });

  it("aperçu du mot obtenu pour chaque touche applicable", () => {
    const bar = describeDiacritics("ma");
    const preview = (id: string) => bar.find((k) => k.id === id)?.preview;
    expect(preview("tone_sac")).toBe(nfc("má"));
    expect(preview("tone_nang")).toBe(nfc("mạ"));
    expect(preview("circ_a")).toBe(nfc("mâ"));
    expect(preview("breve_a")).toBe(nfc("mă"));
    // Pas de o, pas de u, pas de d : touches inapplicables.
    expect(preview("horn_o")).toBeNull();
    expect(preview("stroke_d")).toBeNull();
    expect(preview("tone_none")).toBeNull();
  });

  it("la barre pose la marque, elle ne l'annule jamais (contrairement à la double frappe)", () => {
    expect(applyDiacritic(nfc("má"), "tone_sac")).toBe(nfc("má"));
    expect(applyDiacritic(nfc("â"), "circ_a")).toBe(nfc("â"));
    expect(applyDiacritic(nfc("đ"), "stroke_d")).toBe(nfc("đ"));
    // Changer de ton reste possible.
    expect(applyDiacritic(nfc("má"), "tone_huyen")).toBe(nfc("mà"));
    expect(applyDiacritic(nfc("má"), "tone_none")).toBe("ma");
  });

  it("uo + corne donne ươ, et le ton se replace", () => {
    expect(applyDiacritic(nfc("mượn".normalize("NFC")), "tone_nang")).toBe(nfc("mượn"));
    expect(applyDiacritic("duong", "horn_o")).toBe(nfc("dương"));
    expect(applyDiacritic("dong", "stroke_d")).toBe(nfc("đong"));
  });

  it("identifiant inconnu : mot inchangé (NFC)", () => {
    expect(applyDiacritic("má", "inconnu")).toBe(nfc("má"));
  });
});
