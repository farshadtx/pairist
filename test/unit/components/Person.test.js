import { shallow, createLocalVue } from "@vue/test-utils"
import flushPromises from "flush-promises"
import Vuex from "vuex"

const localVue = createLocalVue()

localVue.use(Vuex)

import ContextMenu from "@/components/ContextMenu"
import PersonDialog from "@/components/team/PersonDialog"
import Person from "@/components/team/Person"

jest.mock("@/assets/no-picture.svg", () => {
  return "no-picture.svg"
})

jest.mock("@/assets/error-image.svg", () => {
  return "error-image.svg"
})

describe("Person", () => {
  let actions
  let store

  beforeEach(() => {
    actions = {
      remove: jest.fn(),
    }
    store = new Vuex.Store({
      state: {},
      modules: {
        people: {
          namespaced: true,
          actions,
        },
      },
    })
  })

  it("renders with no exceptions", () => {
    shallow(Person, { store, localVue,
      propsData: {
        person: { ".key": "p1", "name": "Bart" },
      },
    })
  })

  it("shows a persons name and picture", () => {
    const wrapper = shallow(Person, { store, localVue,
      propsData: {
        person: { ".key": "p1", "name": "Lisa", "picture": "lisas-picture.png" },
      },
    })

    expect(wrapper.find(".name").html()).toContain("Lisa")
    expect(wrapper.find("v-avatar img").attributes().src).toEqual("lisas-picture.png")
  })

  it("defaults to no avatar", () => {
    const wrapper = shallow(Person, { store, localVue,
      propsData: {
        person: { ".key": "p2", "name": "Bob" },
      },
    })

    expect(wrapper.find(".name").html()).toContain("Bob")
    expect(wrapper.find("v-avatar img").attributes().src).toEqual("no-picture.svg")
  })

  it("shows an error image if avatar can't be loaded", async () => {
    const wrapper = shallow(Person, { store, localVue,
      propsData: {
        person: { ".key": "p2", "name": "Error" },
      },
    })

    expect(wrapper.find(".name").html()).toContain("Error")

    const avatar = wrapper.find("v-avatar img")
    avatar.trigger("error")
    await flushPromises()
    expect(avatar.attributes().src).toEqual("error-image.svg")
  })

  it("updates name's font size based on length", async () => {
    const person = { ".key": "p3", "name": "N" }
      , wrapper = shallow(Person, { store, localVue,
        propsData: {
          person: person,
        },
      })

    const name = wrapper.find(".name span")
    expect(name.text()).toEqual("N")
    expect(name.element.style.fontSize).toEqual("20px")

    person.name = "12345678"
    await flushPromises()
    expect(name.element.style.fontSize).toEqual("18px")

    person.name = "123456789"
    await flushPromises()
    expect(name.element.style.fontSize).toEqual("17px")

    person.name = "1234567890"
    await flushPromises()
    expect(name.element.style.fontSize).toEqual("14px")
  })

  it("shows a context menu on right click", async () => {
    const wrapper = shallow(Person, { store, localVue,
      propsData: {
        person: { ".key": "p", "name": "Person" },
      },
    })

    const menu = wrapper.find(ContextMenu)
    const open = wrapper.vm.$refs.menu.open = jest.fn()
    expect(menu.exists()).toBeTruthy()
    wrapper.find(".person").trigger("contextmenu")
    await flushPromises()
    expect(open).toHaveBeenCalled()
  })

  it("shows person edit when clicking edit", () => {
    const wrapper = shallow(Person, { store, localVue,
      propsData: {
        person: { ".key": "p", "name": "Person" },
      },
    })

    const menu = wrapper.find(ContextMenu)
    expect(menu.vm.showEdit).toBe(true)

    const open = wrapper.vm.$refs.personDialog.open = jest.fn()
    wrapper.vm.edit()
    expect(open).toHaveBeenCalled()
  })

  it("removes person when clicking remove", () => {
    const wrapper = shallow(Person, { store, localVue,
      propsData: {
        person: { ".key": "p", "name": "Person" },
      },
    })

    wrapper.vm.remove()
    expect(actions.remove).toHaveBeenCalled()
    expect(actions.remove).toHaveBeenCalledWith(expect.anything(), "p", undefined)
  })
})
