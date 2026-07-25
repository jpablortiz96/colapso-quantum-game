import { driver, type DriveStep, type Driver } from "driver.js";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { useDailyGameStore } from "../store/daily-game-store";

type TourStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

const stepIndex = (step: TourStep) => step - 1;

function scrollTargetIntoView(element: Element | undefined, tour: Driver, reducedMotion: boolean): void {
  if (!(element instanceof HTMLElement)) return;
  element.classList.add("tour-target-active");
  element.scrollIntoView?.({
    behavior: reducedMotion ? "auto" : "smooth",
    block: "center",
    inline: "nearest",
  });
  window.setTimeout(() => tour.refresh(), reducedMotion ? 0 : 180);
}

function tourSteps(reducedMotion: boolean): DriveStep[] {
  const activate = (step: TourStep) => (element: Element | undefined, _driveStep: DriveStep, options: { driver: Driver }) => {
    const state = useDailyGameStore.getState();
    if (state.tutorialStep !== step) state.setTutorialStep(step);
    scrollTargetIntoView(element, options.driver, reducedMotion);
  };
  const deselect = (element: Element | undefined) => element?.classList.remove("tour-target-active");

  return [
    {
      element: '[data-tour="observer"]',
      onHighlightStarted: activate(1),
      onDeselected: deselect,
      popover: {
        title: "Este eres tú",
        description: "Empiezas aquí. Tu ruta comienza en el brillo azul.",
        side: "top",
        align: "center",
      },
    },
    {
      element: '[data-tour="exit"]',
      onHighlightStarted: activate(2),
      onDeselected: deselect,
      popover: {
        title: "Esta es la salida",
        description: "Llega a la casilla dorada para completar la misión.",
        side: "bottom",
        align: "end",
      },
    },
    {
      element: '[data-tour="possibility"]',
      onHighlightStarted: activate(3),
      onDeselected: deselect,
      popover: {
        title: "Todavía es una posibilidad",
        description: "Las casillas con ? no están definidas. Elige una cercana.",
        side: "top",
        align: "center",
      },
    },
    {
      element: '[data-tour="observe-button"]',
      onHighlightStarted: activate(4),
      onDeselected: deselect,
      disableActiveInteraction: false,
      popover: {
        title: "Obsérvala",
        description: "Pulsa este botón para descubrir qué hay. Gastarás una observación.",
        side: "left",
        align: "center",
        showButtons: ["previous", "close"],
      },
    },
    {
      element: '[data-tour="move-button"]',
      onHighlightStarted: activate(5),
      onDeselected: deselect,
      disableActiveInteraction: false,
      skipMissingElement: true,
      popover: {
        title: "Si hay camino, avanza",
        description: "Una vez descubierta una casilla transitable, puedes moverte aquí.",
        side: "left",
        align: "center",
        showButtons: ["previous", "close"],
      },
    },
    {
      element: '[data-tour="decoherence"]',
      onHighlightStarted: activate(6),
      onDeselected: deselect,
      popover: {
        title: "No tardes demasiado",
        description: "Cada cuatro turnos, el universo colapsa una casilla por su cuenta.",
        side: "bottom",
        align: "center",
      },
    },
    {
      element: '[data-tour="powers"]',
      onHighlightStarted: activate(7),
      onDeselected: deselect,
      popover: {
        title: "Poderes cuánticos",
        description: "X y H cambian probabilidades antes de observar. Úsalos con intención.",
        side: "left",
        align: "center",
      },
    },
    {
      element: '[data-tour="mission-goal"]',
      onHighlightStarted: activate(8),
      onDeselected: deselect,
      popover: {
        title: "Tu meta es la ruta",
        description: "No necesitas descubrir todo el tablero: encuentra un camino hasta la salida.",
        side: "bottom",
        align: "center",
        doneBtnText: "Entendido",
      },
    },
  ];
}

export function PremiumTour() {
  const tutorialStep = useDailyGameStore((state) => state.tutorialStep);
  const reducedMotion = useReducedMotion() ?? false;
  const tourReference = useRef<Driver | null>(null);
  const reducedMotionReference = useRef(reducedMotion);

  useEffect(() => {
    reducedMotionReference.current = reducedMotion;
  }, [reducedMotion]);

  useEffect(() => {
    if (tutorialStep === null) {
      tourReference.current?.destroy();
      tourReference.current = null;
      return;
    }

    if (tourReference.current === null) {
      const tour = driver({
        steps: tourSteps(reducedMotionReference.current),
        animate: !reducedMotionReference.current,
        duration: reducedMotionReference.current ? 0 : 220,
        overlayColor: "#020617",
        overlayOpacity: 0.78,
        stagePadding: 12,
        stageRadius: 18,
        smoothScroll: !reducedMotionReference.current,
        allowClose: false,
        allowScroll: true,
        allowKeyboardControl: true,
        disableActiveInteraction: false,
        skipMissingElement: true,
        waitForElement: 250,
        popoverClass: "colapso-tour-popover",
        popoverOffset: 16,
        showButtons: ["previous", "next", "close"],
        showProgress: true,
        progressText: "Paso {{current}} de {{total}}",
        prevBtnText: "Atrás",
        nextBtnText: "Siguiente",
        doneBtnText: "Entendido",
        overlayClickBehavior: () => undefined,
        onPopoverRender: (popover) => {
          popover.closeButton.textContent = "Saltar";
          popover.closeButton.setAttribute("aria-label", "Saltar tutorial");
          popover.closeButton.style.display = "block";
        },
        onCloseClick: (_element, _step, options) => {
          useDailyGameStore.getState().skipTutorial();
          options.driver.destroy();
        },
        onDoneClick: (_element, _step, options) => {
          useDailyGameStore.getState().completeTutorial();
          options.driver.destroy();
        },
      });
      tourReference.current = tour;
      tour.drive(stepIndex(tutorialStep));
      return;
    }

    const expectedIndex = stepIndex(tutorialStep);
    if (tourReference.current.getActiveIndex() !== expectedIndex) {
      tourReference.current.moveTo(expectedIndex);
    }
  }, [tutorialStep]);

  useEffect(() => () => {
    tourReference.current?.destroy();
    tourReference.current = null;
  }, []);

  return null;
}
