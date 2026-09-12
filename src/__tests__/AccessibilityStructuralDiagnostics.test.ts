import { assessUberStructuralOffer } from "@/services/AccessibilityStructuralDiagnostics";
import type { AccessibilityNodeSnapshot, AccessibilitySnapshot } from "../../modules/motorista-notification-listener";

function snap(packageName: string, nodes: AccessibilityNodeSnapshot[]): AccessibilitySnapshot {
  return { packageName, capturedAt: Date.now(), nodes, nodeCount: nodes.length };
}

describe("AccessibilityStructuralDiagnostics", () => {
  it("marca overlay Uber sem texto como candidato estrutural", () => {
    const nodes: AccessibilityNodeSnapshot[] = [
      { text: null, className: "TextView", viewId: "offer_title", left: 40, top: 420, right: 500, bottom: 470, origin: "window", windowId: 7 },
      { text: null, className: "TextView", viewId: "trip_summary", left: 40, top: 480, right: 500, bottom: 530, origin: "window", windowId: 7 },
      { text: null, className: "TextView", viewId: "request_details", left: 40, top: 540, right: 500, bottom: 590, origin: "window", windowId: 7 },
      { text: null, className: "TextView", left: 40, top: 600, right: 500, bottom: 650, origin: "window", windowId: 7 },
      { text: null, className: "Button", viewId: "accept_button", clickable: true, left: 60, top: 700, right: 1020, bottom: 790, origin: "window", windowId: 7 },
      { text: null, className: "ViewGroup", left: 20, top: 390, right: 1060, bottom: 820, origin: "window", windowId: 7 }
    ];

    const result = assessUberStructuralOffer(snap("com.ubercab.driver", nodes));
    expect(result.candidate).toBe(true);
    expect(["medium", "high"]).toContain(result.confidence);
    expect(result.windowId).toBe(7);
  });

  it("não marca estrutura simples do mapa Uber como oferta", () => {
    const nodes: AccessibilityNodeSnapshot[] = [
      { text: null, className: "ViewGroup", viewId: "online_view_container", left: 0, top: 0, right: 1080, bottom: 1900, origin: "activeRoot", windowId: 3 },
      { text: null, className: "View", viewId: "rxmap", left: 0, top: 150, right: 1080, bottom: 1700, origin: "activeRoot", windowId: 3 },
      { text: null, className: "View", viewId: "map_marker", left: 300, top: 500, right: 360, bottom: 560, origin: "activeRoot", windowId: 3 },
      { text: null, className: "TextView", viewId: "text_container", left: 20, top: 1650, right: 400, bottom: 1700, origin: "activeRoot", windowId: 3 },
      { text: null, className: "View", left: 0, top: 0, right: 100, bottom: 100, origin: "activeRoot", windowId: 3 }
    ];

    expect(assessUberStructuralOffer(snap("com.ubercab.driver", nodes)).candidate).toBe(false);
  });

  it("não aplica heurística estrutural da Uber à 99", () => {
    const nodes: AccessibilityNodeSnapshot[] = [
      { className: "TextView", viewId: "offer_title", left: 20, top: 20, right: 400, bottom: 70, origin: "window", windowId: 8 },
      { className: "TextView", left: 20, top: 80, right: 400, bottom: 130, origin: "window", windowId: 8 },
      { className: "TextView", left: 20, top: 140, right: 400, bottom: 190, origin: "window", windowId: 8 },
      { className: "Button", viewId: "accept_button", clickable: true, left: 50, top: 300, right: 1000, bottom: 390, origin: "window", windowId: 8 },
      { className: "ViewGroup", left: 0, top: 0, right: 1080, bottom: 430, origin: "window", windowId: 8 }
    ];

    expect(assessUberStructuralOffer(snap("com.app99.driver", nodes)).candidate).toBe(false);
  });
});
