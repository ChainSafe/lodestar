```mermaid
gantt
    title Lodestar 2026 Development Roadmap
    dateFormat YYYY-MM-DD
    tickInterval 1w
    excludes weekends

    section State-Transition
        Spec Tests (Tuyen):                  st1, 2025-12-01, 31d
        Tree-View APIs (Kai):              st2, 2025-12-01, 31d
        Tree-View PR Review (Cayman/Bing):         st3, after st2, 14d
        Tree-View Improvements (Tuyen/Kai):      st4, after st2, 14d
        Lodestar Impl Investigation (Tuyen): st5, 2026-01-01, 14d
        Impl Review (Matt/Nazar): st10, after st5, 8d
        TypeScript API Interface:    st6, after st5, 1d
        Metrics Implementation:      st7, 2025-12-01, 30d
        Bindings:                    st8, after st6, 7d
        Lodestar Integration: st10, after st8, 5d
        Lodestar Soaking: st11, after st10, 5d
        Benchmarking:                st9, after st8, 14d

    section Zig R&D Roadmap
        Architecture Planning (Cayman/Matt):                    zr1, 2026-02-17, 14d


```

<!--
        Benchmarking R&D:               zr2, after zr1, 30d
        Napi Bindings (napi-z repo):    zr3, 2025-12, 30d

    section LodestarZ
        Fork-Choice:                    lz1, 2026-07, 45d
        Execution-Engine:               lz2, 2026-07, 45d
        Clock:                          lz3, 2026-07, 45d
        Database:                       lz3, 2026-07, 45d
        Seen-Cache:                     lz3, 2026-07, 45d
        Op-Pools:                       lz3, 2026-07, 45d
        Peer:                           lz3, 2026-07, 45d

        Peer Manager:                   lz3, 2026-07, 45d
-->
