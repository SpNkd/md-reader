# Security fixture

This file contains input that must stay inert:

<script>document.body.dataset.xss = "executed"</script>

<img src="x" onerror="document.body.dataset.xss = 'executed'">

[Unsafe link](javascript:document.body.dataset.xss = 'executed')

[Safe link](https://example.com)
