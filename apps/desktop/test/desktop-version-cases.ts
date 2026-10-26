export const desktopVersionCases = [
  { current: "0.47.1", latest: "0.47.1-r1", available: true },
  { current: "0.47.1-r1", latest: "0.47.1-r2", available: true },
  { current: "0.47.1-r2", latest: "0.47.1-r10", available: true },
  { current: "0.47.1-r10", latest: "0.47.1-r2", available: false },
  { current: "0.47.1-r2", latest: "0.47.1-r2", available: false },
  { current: "0.47.1-r2", latest: "0.47.1", available: false },
  { current: "0.47.1-r0", latest: "0.47.1", available: false },
  { current: "0.47.1-r10", latest: "0.47.2", available: true },
  { current: "0.47.1-r10", latest: "0.47.2-r1", available: true },
  { current: "0.47.2", latest: "0.47.1-r10", available: false },
  { current: "0.47.1-nightly.2", latest: "0.47.1-nightly.10", available: true },
  { current: "0.47.1", latest: "0.47.1-nightly.10", available: false },
];
