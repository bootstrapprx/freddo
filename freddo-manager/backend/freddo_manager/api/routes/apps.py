"""Catalogo, releases e validacao de repositorios de apps Frappe."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from ...apps import FRAMEWORK_VERSIONS, AppRegistry, validate_app_name
from ...security import allowed_stepup
from ..deps import StateDep, WriteAuth, require_auth, verify_csrf
from ..read import read
from ..schemas import AppCreateRequest, AppLifecycleRequest, AppReleaseRequest, AppUpdateRequest, JobResponse

router = APIRouter(prefix="/apps", tags=["apps"], dependencies=[Depends(require_auth)])


@router.get("")
async def list_apps(state: StateDep, include_archived: bool = False) -> list[dict]:
    return await AppRegistry(state.db).list_apps(include_archived)


@router.post("", status_code=201, dependencies=[Depends(verify_csrf)])
async def create_app(payload: AppCreateRequest, auth: WriteAuth, state: StateDep) -> dict:
    registry = AppRegistry(state.db)
    if await registry.get_app(payload.name):
        raise HTTPException(status_code=409, detail="app_already_exists")
    await registry.save_app(payload.name, payload.title, payload.repository_url, payload.enabled)
    await state.audit.record("app.create", target=payload.name, detail={"repository_url": payload.repository_url}, ip=auth.ip)
    return await registry.get_app(payload.name) or {}


@router.put("/{name}", dependencies=[Depends(verify_csrf)])
async def update_app(name: str, payload: AppUpdateRequest, auth: WriteAuth, state: StateDep) -> dict:
    try:
        name = validate_app_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="app_name_invalid") from exc
    if name == "frappe" and not payload.enabled:
        raise HTTPException(status_code=409, detail="frappe_framework_cannot_be_disabled")
    registry = AppRegistry(state.db)
    if not await registry.get_app(name):
        raise HTTPException(status_code=404, detail="app_not_found")
    await registry.save_app(name, payload.title, payload.repository_url, payload.enabled)
    await state.audit.record(
        "app.update", target=name, detail={"repository_url": payload.repository_url, "enabled": payload.enabled}, ip=auth.ip
    )
    return await registry.get_app(name) or {}


@router.put("/{name}/releases/{framework_version}", dependencies=[Depends(verify_csrf)])
async def save_release(
    name: str, framework_version: str, payload: AppReleaseRequest, auth: WriteAuth, state: StateDep
) -> dict:
    registry = AppRegistry(state.db)
    if framework_version not in FRAMEWORK_VERSIONS:
        raise HTTPException(status_code=422, detail="framework_version_not_supported")
    try:
        name = validate_app_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="app_name_invalid") from exc
    app = await registry.get_app(name)
    if not app or app["archived"]:
        raise HTTPException(status_code=404, detail="app_not_found")
    await registry.save_release(name, framework_version, payload.ref)
    await state.audit.record(
        "app.release.update", target=name, detail={"framework_version": framework_version, "ref": payload.ref}, ip=auth.ip
    )
    return await registry.get_release(name, framework_version) or {}


@router.post("/{name}/releases/{framework_version}/archive", status_code=204, dependencies=[Depends(verify_csrf)])
async def archive_release(
    name: str, framework_version: str, auth: WriteAuth, state: StateDep
) -> None:
    if framework_version not in FRAMEWORK_VERSIONS:
        raise HTTPException(status_code=422, detail="framework_version_not_supported")
    try:
        name = validate_app_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="app_name_invalid") from exc
    if not await state.db.archive_managed_release(name, framework_version):
        raise HTTPException(status_code=404, detail="app_release_not_found")
    await state.audit.record(
        "app.release.archive", target=name, detail={"framework_version": framework_version}, ip=auth.ip
    )


@router.post("/{name}/archive", status_code=204, dependencies=[Depends(verify_csrf)])
async def archive_app(name: str, auth: WriteAuth, state: StateDep) -> None:
    try:
        name = validate_app_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="app_name_invalid") from exc
    if name == "frappe":
        raise HTTPException(status_code=409, detail="frappe_framework_cannot_be_archived")
    if not await AppRegistry(state.db).archive_app(name):
        raise HTTPException(status_code=404, detail="app_not_found")
    await state.audit.record("app.archive", target=name, ip=auth.ip)


@router.post("/{name}/validate/{framework_version}", status_code=202, dependencies=[Depends(verify_csrf)])
async def validate_app(
    name: str, framework_version: str, auth: WriteAuth, state: StateDep
) -> JobResponse:
    if framework_version not in FRAMEWORK_VERSIONS:
        raise HTTPException(status_code=422, detail="framework_version_not_supported")
    try:
        name = validate_app_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="app_name_invalid") from exc
    registry = AppRegistry(state.db)
    app = await registry.get_app(name)
    release = await registry.get_release(name, framework_version)
    if not app or app["archived"]:
        raise HTTPException(status_code=404, detail="app_not_found")
    if not release:
        raise HTTPException(status_code=404, detail="app_release_not_found")
    if release["validation_state"] == "running" and release.get("validation_job_id"):
        current = await state.db.get_job(release["validation_job_id"])
        if current and current["state"] in {"queued", "running"}:
            raise HTTPException(status_code=409, detail="app_validation_running")
    job_id, created = await state.jobs.submit("app.validate", {"app": name, "framework_version": framework_version})
    await state.db.record_app_validation_job(name, framework_version, job_id)
    await state.audit.record(
        "app.validate", target=name, detail={"framework_version": framework_version, "job_id": job_id}, ip=auth.ip
    )
    return JobResponse(
        id=job_id, kind="app.validate", bench=None, state="queued", created_at=0, created_now=created
    )


@router.post("/{name}/test/{framework_version}", status_code=202, dependencies=[Depends(verify_csrf)])
async def test_app(name: str, framework_version: str, auth: WriteAuth, state: StateDep) -> JobResponse:
    if framework_version not in FRAMEWORK_VERSIONS:
        raise HTTPException(status_code=422, detail="framework_version_not_supported")
    try:
        name = validate_app_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="app_name_invalid") from exc
    registry = AppRegistry(state.db)
    app = await registry.get_app(name)
    release = await registry.get_release(name, framework_version)
    framework = await registry.get_release("frappe", framework_version)
    if not app or app["archived"] or not app["enabled"] or not release or not framework:
        raise HTTPException(status_code=404, detail="app_release_not_found")
    if framework["validation_state"] != "passed" or not framework["validated_commit"]:
        raise HTTPException(status_code=409, detail="frappe_release_requires_validation")
    if release["validation_state"] != "passed" or not release["validated_commit"]:
        raise HTTPException(status_code=409, detail="app_release_requires_validation")
    if release["test_state"] == "running" and release.get("test_job_id"):
        current = await state.db.get_job(release["test_job_id"])
        if current and current["state"] in {"queued", "running"}:
            raise HTTPException(status_code=409, detail="app_test_running")
    temp_name = f"freddo-app-test-{name[:20]}-{job_id_suffix()}"
    job_id, created = await state.jobs.submit(
        "app.test", {"app": name, "framework_version": framework_version, "bench": temp_name}, bench=temp_name,
    )
    await registry.record_test_result(
        name, framework_version, app["repository_url"], release["ref"], release["validated_commit"],
        "running", job_id, None,
    )
    await state.audit.record("app.test", target=name, detail={"framework_version": framework_version, "job_id": job_id}, ip=auth.ip)
    return JobResponse(id=job_id, kind="app.test", bench=temp_name, state="queued", created_at=0, created_now=created)


def job_id_suffix() -> str:
    import secrets

    return secrets.token_hex(4)


@router.post("/{name}/lifecycle/{operation}", status_code=202, dependencies=[Depends(verify_csrf)])
async def app_lifecycle(
    name: str, operation: str, payload: AppLifecycleRequest, auth: WriteAuth, state: StateDep
) -> JobResponse:
    if operation not in {"install", "update", "uninstall-preview", "uninstall"}:
        raise HTTPException(status_code=404, detail="unknown_app_operation")
    if payload.framework_version not in FRAMEWORK_VERSIONS:
        raise HTTPException(status_code=422, detail="framework_version_not_supported")
    try:
        name = validate_app_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="app_name_invalid") from exc
    if operation == "uninstall" and not allowed_stepup(auth.stepup_until):
        raise HTTPException(status_code=403, detail="stepup_required")
    if operation == "uninstall" and payload.confirm != f"{name}@{payload.bench}":
        raise HTTPException(status_code=400, detail="confirmation_required")
    try:
        existing = next((item for item in await read(state, "fm.list") if item.get("name") == payload.bench), None)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="bench_state_unavailable") from exc
    if not existing:
        raise HTTPException(status_code=404, detail="bench_not_found")
    if payload.site not in existing.get("sites", []):
        raise HTTPException(status_code=404, detail="site_not_found")
    actual_version = str(existing.get("version") or "").lower()
    actual_version = "develop" if actual_version == "develop" else f"v{actual_version.removeprefix('version-').removeprefix('v').split('.')[0]}"
    if actual_version != payload.framework_version:
        raise HTTPException(status_code=409, detail="app_release_incompatible_with_bench")
    release = await AppRegistry(state.db).get_release(name, payload.framework_version)
    app = await AppRegistry(state.db).get_app(name)
    if not app or not app["enabled"] or app["archived"] or not release:
        raise HTTPException(status_code=404, detail="app_release_not_found")
    op = {"uninstall-preview": "app.uninstall.preview"}.get(operation, f"app.{operation}")
    args = {
        "app": name, "framework_version": payload.framework_version,
        "bench": payload.bench, "site": payload.site,
    }
    if operation == "uninstall":
        args["confirm"] = payload.confirm
    job_id, created = await state.jobs.submit(op, args, bench=payload.bench)
    await state.audit.record(op, target=name, detail={"bench": payload.bench, "site": payload.site, "job_id": job_id}, ip=auth.ip)
    return JobResponse(id=job_id, kind=op, bench=payload.bench, state="queued", created_at=0, created_now=created)
