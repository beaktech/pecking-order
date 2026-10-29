# English bird names

`common-names.en.json` is derived from the **IOC World Bird List, version 15.2**,
edited by **Frank Gill, David Donsker and Pamela Rasmussen (2026)**.

- Source: [IOC master lists](https://www.worldbirdnames.org/new/ioc-lists/master-list-2/)
- Original spreadsheet: https://worldbirdnames.org/master_ioc_list_v15.2.xlsx
- DOI: https://doi.org/10.14344/IOC.ML.15.2
- Licence: [Creative Commons Attribution 3.0 Unported (CC BY 3.0)](https://creativecommons.org/licenses/by/3.0/), as stated in the source site's footer.
- Downloaded: 27 October 2026.
- Original spreadsheet SHA-256: `cbe406f71656323fafc6e30114385337c8c1cba54223b35fc668b3827bf28324`.

Changes: extracted the 11,227 scientific species names (genus plus species epithet)
and corresponding English species names into an alphabetically sorted JSON map.
Other spreadsheet columns, subspecies, formatting and comments are omitted.
No English names have been rewritten, and no taxonomic equivalences are inferred.
The source's CC BY 3.0 licence applies to this derived lookup data. The editors
do not endorse Pecking Order. Pecking Order's application code is licensed separately
under MIT; see the root LICENSE file.

To reproduce the JSON using Python's standard library:

```sh
python3 scripts/build-common-names.py /path/to/master_ioc_list_v15.2.xlsx
```

This is an offline display fallback. Names supplied by the recording source or
an explicit labels file take precedence. Species absent from this list retain
their scientific names. The app performs no online name lookups.
