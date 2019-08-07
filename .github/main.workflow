workflow "Daily" {
  on = "schedule(0 0 * * *)"
  resolves = ["Test"]
}

action "Bootstrap" {
  uses = "m19c/action-lerna@master"
  args = "bootstrap"
}

action "Test" {
  uses = "m19c/action-lerna@master"
  needs = ["Bootstrap"]
  args = "run test"
}
