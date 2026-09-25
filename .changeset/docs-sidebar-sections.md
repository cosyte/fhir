---
"@cosyte/fhir": patch
---

Docs: the documentation sidebar now groups its pages into Installation, Quickstart, Core Concepts, Guides and Troubleshooting sections.

docs.cosyte.com lists a package's installation and quickstart pages only when its sidebar ships each of them as a section, and it does not count a page listed on its own as either, so this is the layout that lets the site publish them. Current limits now sits under Troubleshooting. The documentation check in this repository reads a sidebar written in sections: every page a section lists must exist, and every page must still be reachable from the sidebar.

No runtime change: nothing under `src/` was touched and the public API is unchanged.
